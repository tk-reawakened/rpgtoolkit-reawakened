// stock_battle's damage seam is deliberately RPGCode (BAT-5, EMIT-13). Each
// action calls one shared helper from the battle thread, so the cancelable
// dispatch parks that thread before any owner-backed stat write can clamp HP
// or SMP or publish a fallen transition.
localDamage = (request) => {
  local(event)
  local(source)
  local(target)
  local(pool)
  local(sourceId)
  source = request.source
  target = request.target
  pool = request.pool
  if (target == null) {
    return 0
  }
  sourceId = null
  if (source != null) {
    sourceId = source.id
  }
  event = target.emitCancelable("beforeDamage", {
    source: sourceId,
    target: target.id,
    damage: request.amount
  })
  if (event.canceled == 1) {
    return 0
  }
  return target.damage(event.detail.damage, sourceId, pool)
}

physical = (request) => {
  request.pool = "hp"
  return localDamage(request)
}

special = (request) => {
  request.pool = "hp"
  return localDamage(request)
}

drain = (request) => {
  request.pool = "smp"
  return localDamage(request)
}

attackall = (request) => {
  local(total)
  total = 0
  if (request.first != null) {
    if (request.first.hp > 0) {
      total = total + physical({ source: request.source, target: request.first, amount: request.amount })
    }
  }
  if (request.second != null) {
    if (request.second.hp > 0) {
      total = total + physical({ source: request.source, target: request.second, amount: request.amount })
    }
  }
  if (request.third != null) {
    if (request.third.hp > 0) {
      total = total + physical({ source: request.source, target: request.third, amount: request.amount })
    }
  }
  return total
}

drainall = (request) => {
  local(total)
  total = 0
  if (request.first != null) {
    if (request.first.hp > 0) {
      total = total + drain({ source: request.source, target: request.first, amount: request.amount })
    }
  }
  if (request.second != null) {
    if (request.second.hp > 0) {
      total = total + drain({ source: request.source, target: request.second, amount: request.amount })
    }
  }
  if (request.third != null) {
    if (request.third.hp > 0) {
      total = total + drain({ source: request.source, target: request.third, amount: request.amount })
    }
  }
  return total
}

// BAT-4: this hook spends the acting turn; the default enemy turn below reads
// `.ene` battle settings and uses the four built-in strategies or custom AI.
// A game or later stock-battle module can replace stockBattle.turn with
// `(party, index) => { ... }`. It runs on the loop's ONE thread; waits keep
// every fighter's charge parked, and the loop releases charge after return.
stockBattle = {
  enemyDataCache: {},
  specialDataCache: {},
  battleBackgroundDataCache: null,
  // Reusable setup-only entry points for custom fight programs. They share the
  // core setup path with Fight/FightEnemy but leave the caller's loop in charge.
  prepareRandom: (skill, background) => __battle_prepare_random(skill, background),
  prepareEnemies: (e1, e2, e3, e4, background) => __battle_prepare_enemies(e1, e2, e3, e4, background),
  defeatedIds: {},
  defeatedListeners: {},
  defeatedListenerCount: 0,
  livingCounts: { enemies: 0, players: 0 },
  fighterCounts: { enemies: 0, players: 0 },
  pendingOutcome: 0,
  coreOutcomePending: 0,
  decidedOutcome: 0,
  active: 0,
  runPending: 0,
  // Custom AI programs receive source/target actor IDs as strings. Resolve one
  resolveFighter: (handle) => {
    local(wanted)
    local(party) = 0
    local(index) = 0
    local(size)
    local(candidate)
    if (handle == null) {
      return null
    }
    wanted = handle
    if (handle == "source") {
      wanted = sourceHandle()
    }
    if (handle == "target") {
      wanted = targetHandle()
    }
    if (wanted == null || wanted == 0) {
      return null
    }
    while (party < 2) {
      size = battle.partySize(party)
      index = 0
      while (index < size) {
        candidate = battle.fighter(party, index)
        if (candidate != null) {
          if ("" + candidate.id == "" + wanted) {
            return candidate
          }
        }
        index = index + 1
      }
      party = party + 1
    }
    return null
  },
  enemyData: (fighter) => {
    local(key) = "" + fighter.id
    local(data)
    if (stockBattle.enemyDataCache == null) {
      stockBattle.enemyDataCache = {}
    }
    data = stockBattle.enemyDataCache[key]
    if (data == null) {
      data = battleenemydata(fighter)
      if (data != null) {
        stockBattle.enemyDataCache[key] = data
      }
    }
    return data
  },
  refreshPendingOutcome: () => {
    if (stockBattle.fighterCounts.players > 0 && stockBattle.livingCounts.players < 1) {
      stockBattle.pendingOutcome = 4
    } else {
      if (stockBattle.fighterCounts.enemies > 0 && stockBattle.livingCounts.enemies < 1) {
        stockBattle.pendingOutcome = 2
      } else {
        stockBattle.pendingOutcome = 0
      }
    }
  },
  recheckPendingOutcome: () => {
    local(party) = 0
    local(index)
    local(size)
    local(fighter)
    stockBattle.livingCounts = { enemies: 0, players: 0 }
    stockBattle.fighterCounts = { enemies: 0, players: 0 }
    while (party < 2) {
      size = battle.partySize(party)
      for (index = 0; index < size; index = index + 1) {
        fighter = battle.fighter(party, index)
        if (fighter != null) {
          if (party == 0) {
            stockBattle.fighterCounts.enemies = stockBattle.fighterCounts.enemies + 1
            if (fighter.hp > 0) {
              stockBattle.livingCounts.enemies = stockBattle.livingCounts.enemies + 1
            }
          } else {
            stockBattle.fighterCounts.players = stockBattle.fighterCounts.players + 1
            if (fighter.hp > 0) {
              stockBattle.livingCounts.players = stockBattle.livingCounts.players + 1
            }
          }
        }
      }
      party = party + 1
    }
    stockBattle.refreshPendingOutcome()
  },
  watchPlayer: (fighter) => {
    local(listener)
    stockBattle.fighterCounts.players = stockBattle.fighterCounts.players + 1
    if (fighter.hp > 0) {
      stockBattle.livingCounts.players = stockBattle.livingCounts.players + 1
    }
    listener = (event) => {
      stockBattle.livingCounts.players = stockBattle.livingCounts.players - 1
      stockBattle.refreshPendingOutcome()
    }
    fighter.on("fallen", listener)
    stockBattle.defeatedListeners[stockBattle.defeatedListenerCount] = {
      fighter: fighter, listener: listener
    }
    stockBattle.defeatedListenerCount = stockBattle.defeatedListenerCount + 1
  },
  watchEnemy: (fighter) => {
    local(id) = "" + fighter.id
    local(listener)
    stockBattle.fighterCounts.enemies = stockBattle.fighterCounts.enemies + 1
    if (fighter.hp > 0) {
      stockBattle.livingCounts.enemies = stockBattle.livingCounts.enemies + 1
    }
    listener = (event) => {
      stockBattle.livingCounts.enemies = stockBattle.livingCounts.enemies - 1
      stockBattle.refreshPendingOutcome()
      if (stockBattle.defeatedIds[id] == null) {
        stockBattle.defeatedIds[id] = 1
        emit(fighter, "defeated", {
          cause: event.detail.cause,
          source: event.detail.source
        })
        game.emit("stock_battle.defeated", {
          cause: event.detail.cause,
          source: event.detail.source
        })
      }
    }
    fighter.on("fallen", listener)
    stockBattle.defeatedListeners[stockBattle.defeatedListenerCount] = {
      fighter: fighter, listener: listener
    }
    stockBattle.defeatedListenerCount = stockBattle.defeatedListenerCount + 1
  },
  clearDefeatedListeners: () => {
    local(index) = 0
    local(record)
    while (index < stockBattle.defeatedListenerCount) {
      record = stockBattle.defeatedListeners[index]
      record.fighter.off("fallen", record.listener)
      index = index + 1
    }
    stockBattle.defeatedIds = {}
    stockBattle.defeatedListeners = {}
    stockBattle.defeatedListenerCount = 0
    stockBattle.livingCounts = { enemies: 0, players: 0 }
    stockBattle.fighterCounts = { enemies: 0, players: 0 }
    stockBattle.pendingOutcome = 0
    stockBattle.decidedOutcome = 0
    stockBattle.coreOutcomePending = 0
  },
  canRun: () => {
    local(size)
    local(index) = 0
    local(fighter)
    local(data)
    if (battle.canRun == 0) {
      return 0
    }
    size = battle.partySize(0)
    while (index < size) {
      fighter = battle.fighter(0, index)
      if (fighter != null) {
        data = stockBattle.enemyData(fighter)
        if (data == null || data.canrun == 0) {
          return 0
        }
      }
      index = index + 1
    }
    return 1
  },
  playCantDoSound: () => {
    local(data)
    if (stockBattle.battleBackgroundDataCache == null) {
      stockBattle.battleBackgroundDataCache = battlebackgrounddata()
    }
    data = stockBattle.battleBackgroundDataCache
    if (data != null && data.cantsound != "") {
      mediaPlay(data.cantsound, { track: "ui", loop: 0 })
    }
  },
  run: () => {
    if (stockBattle.canRun() == 0) {
      stockBattle.preserveCharge = 1
      stockBattle.playCantDoSound()
      return 0
    }
    if (random(5) <= 2) {
      stockBattle.runPending = 1
      mwin("Escaped.")
      return 1
    }
    mwin("Could not escape.")
    return 0
  },
  living: (party) => {
    local(result) = { count: 0, fighters: {} }
    local(size) = battle.partySize(party)
    local(index) = 0
    local(candidate)
    while (index < size) {
      candidate = battle.fighter(party, index)
      if (candidate != null) {
        if (candidate.hp > 0) {
          result.fighters[result.count] = candidate
          result.count = result.count + 1
        }
      }
      index = index + 1
    }
    return result
  },
  randomLiving: (living) => {
    if (living.count < 1) {
      return null
    }
    return living.fighters[random(living.count) - 1]
  },
  // Strictly-smaller replacement preserves the earlier party position on ties.
  weakest: (living) => {
    local(index) = 1
    local(candidate)
    local(result)
    if (living.count < 1) {
      return null
    }
    result = living.fighters[0]
    while (index < living.count) {
      candidate = living.fighters[index]
      if (candidate.hp < result.hp) {
        result = candidate
      }
      index = index + 1
    }
    return result
  },
  availableSpecials: (fighter, data) => {
    local(result) = { count: 0, moves: {} }
    local(index) = 0
    local(file)
    local(move)
    while (index < data.specialcount) {
      file = data.specialmoves[index]
      if (file != "") {
        move = stockBattle.specialDataCache[file]
        if (move == null) {
          move = battlemovedata(file)
          if (move != null) {
            stockBattle.specialDataCache[file] = move
          }
        }
        if (move != null) {
          if (move.smp <= fighter.smp) {
            result.moves[result.count] = { file: file, data: move }
            result.count = result.count + 1
          }
        }
      }
      index = index + 1
    }
    return result
  },
  performAi: (fighter, level) => {
    local(players) = stockBattle.living(1)
    local(trySpecial) = 0
    local(data)
    local(available)
    local(choice)
    local(targets)
    local(target)
    if (fighter == null) {
      return 0
    }
    if (fighter.hp < 1) {
      return 0
    }
    if (players.count < 1) {
      return 0
    }
    if (level < 0 || level > 3) {
      ai(level)
      return 0
    }
    if (level == 1 || level == 3) {
      trySpecial = 1
    }
    if (level == 0 || level == 2) {
      if (random(2) == 2) {
        trySpecial = 1
      }
    }
    if (trySpecial != 0) {
      data = stockBattle.enemyData(fighter)
      if (data != null) {
        available = stockBattle.availableSpecials(fighter, data)
        if (available.count > 0) {
          choice = available.moves[random(available.count) - 1]
          if (choice.data.fp < 0) {
            targets = stockBattle.living(0)
            if (level < 2) {
              target = stockBattle.randomLiving(targets)
            } else {
              target = stockBattle.weakest(targets)
            }
          } else {
            if (level < 2) {
              target = stockBattle.randomLiving(players)
            } else {
              target = stockBattle.weakest(players)
            }
          }
          if (target != null) {
            return stockBattle.special(fighter, target, choice.file)
          }
        }
      }
    }
    if (level < 2) {
      target = stockBattle.randomLiving(players)
    } else {
      target = stockBattle.weakest(players)
    }
    if (target == null) {
      return 0
    }
    return stockBattle.attack(fighter, target)
  },
  turn: (party, index) => {
    local(fighter)
    local(players)
    local(data)
    local(target)
    if (party != 0) {
      return 0
    }
    fighter = battle.fighter(party, index)
    if (fighter == null) {
      return 0
    }
    if (fighter.hp < 1) {
      return 0
    }
    players = stockBattle.living(1)
    if (players.count < 1) {
      return 0
    }
    data = stockBattle.enemyData(fighter)
    if (data == null) {
      return 0
    }
    if (data.customai != 0) {
      target = stockBattle.randomLiving(players)
      if (target != null) {
        executeProgram(data.aiprogram, { source: "" + fighter.id, target: "" + target.id })
      }
      return 0
    }
    return stockBattle.performAi(fighter, data.ailevel)
  },
  // Headless games have no battle screen. Positions and drawing belong to
  // ticket 7.11's default UI, which replaces this hook. Returning here does
  // not claim that a drawing request was made or an animation was displayed.
  animate: (file, fighter) => { return 0 },
  attack: (source, target) => {
    if (source == null) {
      return 0
    }
    return stockBattle.attackAmount(source, target, source.fp, "hp")
  },
  // E-74: only positive supplied amounts consume randomness. The offensive
  // critical draw precedes the defensive one, which a successful first draw
  // skips. A missing side (-1) consumes no draw, including for limit zero.
  attackAmount: (source, target, amount, pool) => {
    local(hit)
    if (source == null) {
      return 0
    }
    if (target == null) {
      return 0
    }
    if (source.hp < 1) {
      return 0
    }
    // SEM-3: reading a variable or member by name narrows a number to signed
    // 32 bits, so the luck product goes through integerMulDiv, which keeps the
    // product exact and drops the fraction toward zero before DP is subtracted.
    // Supplied amounts must keep (amount * (100 + p) / 100) within signed 32
    // bits; real stats are 32-bit on disk and 1.09 times a stat that large is
    // not a game value.
    hit = { amount: amount, critical: 0 }
    if (hit.amount > 0) {
      hit.amount = integerMulDiv(hit.amount, 100 + random(20) - 11, 100)
      if (source.criticalBy >= 0) {
        hit.critical = random(source.criticalBy + 1) == 1
      }
      if (hit.critical == 0) {
        if (target.criticalOn >= 0) {
          hit.critical = random(target.criticalOn + 1) == 1
        }
      }
      if (hit.critical == 0) {
        hit.amount = hit.amount - target.dp
      }
    }
    if (hit.amount < 1) {
      hit.amount = 1
    }
    if (pool == "smp") {
      return drain({ source: source, target: target, amount: hit.amount })
    }
    return physical({ source: source, target: target, amount: hit.amount })
  },
  // BAT-5 special move. No luck, critical, DP or floor: FP and target-SMP
  // come off the target, the cost off the user, each clamped by the actor
  // owner. Returns the actual amounts removed (a heal is negative) for the UI.
  // The user's SMP must cover the cost, or `battle.unaffordable` is reported
  // and nothing changes and no random number is drawn.
  special: (source, target, file) => {
    local(move)
    local(result)
    result = { hp: 0, smp: 0, cost: 0 }
    if (source == null) {
      return result
    }
    if (target == null) {
      return result
    }
    if (source.hp < 1) {
      return result
    }
    move = stockBattle.specialDataCache[file]
    if (move == null) {
      move = battlemovedata(file)
      if (move != null) {
        stockBattle.specialDataCache[file] = move
      }
    }
    if (move == null) {
      return result
    }
    if (source.smp < move.smp) {
      battleunaffordable()
      return result
    }
    if (move.fp != 0) {
      result.hp = special({ source: source, target: target, amount: move.fp })
    }
    if (move.targetsmp != 0) {
      result.smp = drain({ source: source, target: target, amount: move.targetsmp })
    }
    if (move.smp != 0) {
      result.cost = source.smp
      source.smp = source.smp - move.smp
      result.cost = result.cost - source.smp
    }
    stockBattle.presentation(fighteranimationfile(source, "special move"), source)
    stockBattle.presentation(move.animation, target)
    if (move.program != "") {
      executeProgram(move.program, { source: "" + source.id, target: "" + target.id })
    }
    if (move.statuseffect != "") {
      applystatus(target, move.statuseffect)
    }
    return result
  },
  // BAT-5 item. The item's battle HP and SMP are added to the target (clamped
  // 0..max by the actor owner), then exactly one consume effect goes to the
  // inventory port, then the item's animation and program. The item list is
  // never read or edited here.
  item: (source, target, file) => {
    local(data)
    local(result)
    result = { hp: 0, smp: 0 }
    if (source == null) {
      return result
    }
    if (target == null) {
      return result
    }
    if (source.hp < 1) {
      return result
    }
    data = battleitemdata(file)
    if (data == null) {
      return result
    }
    if (data.hp != 0) {
      result.hp = special({ source: source, target: target, amount: 0 - data.hp })
    }
    if (data.smp != 0) {
      result.smp = drain({ source: source, target: target, amount: 0 - data.smp })
    }
    battleconsume(file, target, data.hp, data.smp)
    stockBattle.presentation(data.animation, target)
    if (data.program != "") {
      executeProgram(data.program, { source: "" + source.id, target: "" + target.id })
    }
    return result
  },
  // The empty-name guard keeps the hook free of no-animation calls.
  presentation: (file, fighter) => {
    if (file != "") {
      if (file != 0) {
        stockBattle.animate(file, fighter)
      }
    }
    return 0
  },
}

// The owner stores a live battle's outcome as null, distinct from code zero.
battleDecided = () => {
  if (stockBattle.pendingOutcome != 0) {
    stockBattle.recheckPendingOutcome()
  }
  if (stockBattle.pendingOutcome == 4 ||
      (stockBattle.coreOutcomePending != 0 && battle.outcome == 4)) {
    stockBattle.decidedOutcome = 4
    return 1
  }
  if (stockBattle.pendingOutcome == 2) {
    stockBattle.decidedOutcome = 2
    return 1
  }
  if (stockBattle.coreOutcomePending != 0) {
    stockBattle.decidedOutcome = battle.outcome
    return 1
  }
  if (stockBattle.runPending != 0) {
    stockBattle.decidedOutcome = 0
    return 1
  }
  return 0
}
// Status identity and counters belong to the actor; this package loads the
// cached .ste data, interprets its rate flags, and ticks effects at turns.
function battleStatusBefore(leftText, rightText) {
  local(leftKey) = ucase(leftText)
  local(rightKey) = ucase(rightText)
  local(leftLength) = len(leftKey)
  local(rightLength) = len(rightKey)
  local(index) = 1
  local(leftCode)
  local(rightCode)
  while (index <= leftLength && index <= rightLength) {
    leftCode = asc(charat(leftKey, index))
    rightCode = asc(charat(rightKey, index))
    if (leftCode < rightCode) {
      return 1
    }
    if (leftCode > rightCode) {
      return 0
    }
    index = index + 1
  }
  return leftLength < rightLength
}

function battleStatusRate(fighter, cache) {
  local(file)
  local(index) = 0
  local(orderIndex)
  local(sortIndex)
  local(data)
  local(key)
  cache.signature = statussignature(fighter)
  cache.rate = 3
  cache.disabled = 0
  cache.order = {}
  file = getstatus(fighter, index)
  while (file != "") {
    key = ucase(file)
    data = cache.files[key]
    if (data == null) {
      data = statusdata(file)
      if (data == null) {
        data = {
          rounds: 0, speed: 0, slow: 0, disable: 0,
          hp: 0, hpamount: 0, smp: 0, smpamount: 0,
          runprogram: 0, program: ""
        }
      }
      cache.files[key] = data
    }
    cache.rate = cache.rate + 2 * data.speed - 2 * data.slow
    cache.disabled = cache.disabled + data.disable
    cache.order[index + 1] = file
    index = index + 1
    file = getstatus(fighter, index)
  }
  cache.statusCount = index
  for (orderIndex = 2; orderIndex <= cache.statusCount; orderIndex = orderIndex + 1) {
    file = cache.order[orderIndex]
    sortIndex = orderIndex - 1
    while (sortIndex >= 1 && battleStatusBefore(file, cache.order[sortIndex])) {
      cache.order[sortIndex + 1] = cache.order[sortIndex]
      sortIndex = sortIndex - 1
    }
    cache.order[sortIndex + 1] = file
  }
  // Keep only ordered effects in the turn hot path; all active statuses still age below.
  if (cache.statusCount > 0) {
    cache.effectOrder = {}
    cache.effectCount = 0
    for (orderIndex = 1; orderIndex <= cache.statusCount; orderIndex = orderIndex + 1) {
      file = cache.order[orderIndex]
      data = cache.files[ucase(file)]
      if ((data.hp != 0 && data.hpamount != 0) ||
          (data.smp != 0 && data.smpamount != 0) || data.runprogram != 0) {
        cache.effectCount = cache.effectCount + 1
        cache.effectOrder[cache.effectCount] = { file: file, data: data }
      }
    }
  }
  return cache.rate
}

function battleStatusTurn(fighter, cache) {
  local(position) = 1
  local(effect)
  local(file)
  local(data)
  while (position <= cache.effectCount) {
    effect = cache.effectOrder[position]
    file = effect.file
    data = effect.data
    if (data.hp != 0 && data.hpamount != 0) {
      __battle_status_delta(fighter, "hp", data.hpamount)
    }
    if (data.smp != 0 && data.smpamount != 0) {
      __battle_status_delta(fighter, "smp", data.smpamount)
    }
    if (data.runprogram != 0) {
      executeProgram(data.program, { source: "" + fighter.id, target: "" + fighter.id, status: file })
    }
    position = position + 1
  }
  if (cache.statusCount > 0) {
    __battle_status_advance(fighter, 1)
  }
}

// The start command supplies the battle section. This package owns charge,
// status rounds/effects, and the action thread's turn seam.
// BAT-4 idle-pass ceilings are 476/626/701 steps for six/eight/nine fighters;
// measured passes use 440/576/644 with no statuses or one cached inert status
// per fighter, within STEP_BUDGET=1000. Status changes and turns can preempt;
// BAT-4 resumes the saved pass.
function battle() {
  local(party)
  local(index)
  local(size)
  local(threshold)
  local(fighter)
  local(charge)
  local(cache)
  local(position)
  local(count) = 0
  local(readySound) = ""
  local(fighters) = {}
  local(done) = 0
  stockBattle.active = 1
  stockBattle.clearDefeatedListeners()
  stockBattle.enemyDataCache = {}
  stockBattle.specialDataCache = {}
  // BAT-10 cue inventory: the fight background's cue files are read once, here,
  // so a pass never parks on a file request. An empty field is silent.
  stockBattle.battleBackgroundDataCache = battlebackgrounddata()
  if (stockBattle.battleBackgroundDataCache != null) {
    readySound = stockBattle.battleBackgroundDataCache.readysound
  }
  stockBattle.runPending = 0
  stockBattle.preserveCharge = 0
  // BAT-2 fixes the battle's fighter lists. Capture their ordered references
  // and constants once, not mutable HP or status data. Restore keeps these
  // dictionaries and actor handles; it does not rebuild or reseed the battle.
  for (party = 0; party < 2; party = party + 1) {
    threshold = party == 0 ? 123 : 75
    size = battle.partySize(party)
    for (index = 0; index < size; index = index + 1) {
      battle.setCharge(party, index, random(threshold) - 1)
      fighter = battle.fighter(party, index)
      if (fighter != null) {
        fighters[count] = {
          party: party, index: index, threshold: threshold, fighter: fighter, files: {}, ready: 0
        }
        count = count + 1
      }
    }
  }
  // Resolve current status assets only after every initial seeded draw. Empty
  // status sets need no status-rule load; their stock cache is the base rate.
  for (position = 0; position < count; position = position + 1) {
    cache = fighters[position]
    cache.signature = statussignature(cache.fighter)
    if (cache.signature != "{}") {
      battleStatusRate(cache.fighter, cache)
    } else {
      cache.rate = 3
      cache.disabled = 0
      cache.statusCount = 0
      cache.effectCount = 0
    }
  }
  threadSleep(getThreadId(), 1/60)
  // Capture current actor state and install both parties' watchers before any
  // stock turn can run.
  for (position = 0; position < count; position = position + 1) {
    cache = fighters[position]
    if (cache.party == 0) {
      stockBattle.watchEnemy(cache.fighter)
    } else {
      stockBattle.watchPlayer(cache.fighter)
    }
  }
  stockBattle.refreshPendingOutcome()
  stockBattleUi.begin()
  while (done == 0) {
    while (stockBattle.pendingOutcome == 0 &&
           stockBattle.coreOutcomePending == 0 &&
           stockBattle.runPending == 0) {
      for (position = 0; position < count; position = position + 1) {
        cache = fighters[position]
        fighter = cache.fighter
        if (fighter.hp > 0) {
          if (statussignature(fighter) != cache.signature) {
            battleStatusRate(fighter, cache)
          }
          charge = battle.charge(cache.party, cache.index)
          if (cache.disabled > 0) {
            if (charge >= cache.threshold) {
              battle.setCharge(cache.party, cache.index, cache.threshold - 1)
              cache.ready = 0
            }
          } else {
            if (charge >= cache.threshold) {
              if (cache.statusCount > 0) {
                battleStatusTurn(fighter, cache)
              }
              // A successful run ends at the next pass boundary: later fighters still tick statuses but do not take turns.
              if (stockBattle.runPending == 0) {
                if (cache.ready == 0) {
                  cache.ready = 1
                  if (readySound != "") {
                    mediaPlay(readySound, { track: "ui", loop: 0 })
                  }
                }
                if (cache.party == 1) {
                  stockBattle.preserveCharge = 0
                  stockBattle.turn(cache.party, cache.index)
                  if (stockBattle.preserveCharge == 0) {
                    battle.releaseCharge(cache.party, cache.index)
                    cache.ready = 0
                  }
                } else {
                  stockBattle.turn(cache.party, cache.index)
                  battle.releaseCharge(cache.party, cache.index)
                  cache.ready = 0
                }
              }
            } else {
              battle.addCharge(cache.party, cache.index, cache.rate)
            }
          }
        }
      }
      // Even an idle pass must consume one simulated tick. The outcome is checked
      // only between passes: later fighters still finish the pass that decided it.
      stockBattleUi.pass()
      threadSleep(getThreadId(), 1/60)
    }
    if (battleDecided() != 0) {
      __battle_apply_outcome(stockBattle.decidedOutcome)
      done = 1
    }
  }
  stockBattleUi.finish()
  stockBattle.active = 0
  stockBattle.clearDefeatedListeners()
}

// ---- The default battle screen (BAT-11, entry 7.11) -------------------------------------------------------------
// Everything below only reads the battle and the actors and draws with the ruled primitives: `fillrect`, `drawrect`,
// `pixelText`, `drawenemy` (a fighter's stance frame), `drawcanvas` and `bitmap` (the .bkg picture), into the
// render-now canvas. It owns no rule: the only writes are the package's own `stockBattle.attack`, `special`, `item`
// and `run` calls that the player's choice makes, and the key queue it reads. The screen is on only when the host
// has a screen surface; a headless run keeps the old behaviour (a player's turn is skipped).
stockBattleUi = {
  on: 0,
  w: 0,
  h: 0,
  picture: "",
  screen: 0,
  buffer: 0,
  target: 0,
  layout: {},
  files: {},
  preload: {},
  preloadCount: 0,
  chars: {},
  itemData: {},
  signature: "",
  roster: {},
  rosterCount: 0,
  seen: {},
  scan: 0,
  barScan: 0,
  bars: {},
  mode: "idle",
  cursor: 0,
  top: 0,
  message: "",
  numbers: {},
  numberCount: 0,
  acting: null,
  actingStance: "",
  menuIndex: 0,
  pendingKind: "",
  pendingEntry: null,
  specials: {},
  specialCount: 0,
  items: {},
  itemCount: 0,
  specialsEmpty: 0,
  itemsEmpty: 0,
  targets: {},
  targetCount: 0,
  targetCursor: 0,
  targetParty: 0,
  listKind: "",
  list: {},
  listCount: 0,
  listCursor: 0,
  listTop: 0,
  frames: 0,
  baseTurn: null,
  // One table of layout values so the owner can review the screen as numbers. Everything is derived from the screen
  // size: enemies stay in the upper left, players in the upper right, and the status panel on the bottom edge.
  makeLayout: (w, h) => {
    local(layout) = {}
    layout.w = w
    layout.h = h
    layout.panelH = 128
    layout.panelY = h - 128
    layout.messageY = h - 128 - 24
    layout.messageH = 20
    layout.enemyX = 24
    layout.enemyY = 32
    layout.enemyDX = 120
    layout.enemyDY = 112
    layout.sprite = 64
    layout.playerX = w - 24 - 64
    layout.playerY = 16
    layout.playerDY = 58
    layout.rowX = 16
    layout.rowY = h - 128 + 10
    layout.rowDY = 22
    layout.hpX = 152
    layout.hpW = 128
    layout.smpX = 296
    layout.smpW = 104
    layout.chargeX = 416
    layout.chargeW = 104
    layout.barH = 14
    layout.menuRowH = 24
    layout.listRowH = 22
    layout.listRows = 6
    layout.listW = 296
    layout.numberTicks = 12
    return layout
  },
  // Menu cues come from the .bkg: cursor move, choose, and "cannot" (the existing cantDoSound).
  cue: (kind) => {
    local(data)
    local(file) = ""
    data = stockBattle.battleBackgroundDataCache
    if (data == null) {
      return 0
    }
    if (kind == "select") {
      file = data.selectsound
    }
    if (kind == "choose") {
      file = data.choosesound
    }
    if (kind == "cant") {
      file = data.cantsound
    }
    if (file != "") {
      mediaPlay(file, { track: "ui", loop: 0 })
    }
    return 0
  },
  begin: () => {
    local(w)
    local(h)
    local(screen)
    local(party)
    local(index)
    local(size)
    local(fighter)
    local(source)
    local(stance)
    local(stances) = {}
    local(slot)
    local(key)
    local(file)
    local(scratch)
    stances[0] = "rest"
    stances[1] = "die"
    stances[2] = "fight"
    stances[3] = "special move"
    stockBattleUi.on = 0
    screen = battlescreensize()
    if (screen == null) {
      return 0
    }
    w = screen.width
    h = screen.height
    if (w < 1 || h < 1) {
      return 0
    }
    stockBattleUi.w = w
    stockBattleUi.h = h
    stockBattleUi.layout = stockBattleUi.makeLayout(w, h)
    stockBattleUi.files = {}
    stockBattleUi.preload = {}
    stockBattleUi.preloadCount = 0
    stockBattleUi.chars = {}
    stockBattleUi.itemData = {}
    stockBattleUi.signature = ""
    stockBattleUi.roster = {}
    stockBattleUi.rosterCount = 0
    stockBattleUi.seen = {}
    stockBattleUi.scan = 0
    stockBattleUi.barScan = 0
    stockBattleUi.bars = {}
    stockBattleUi.mode = "idle"
    stockBattleUi.message = ""
    stockBattleUi.numbers = {}
    stockBattleUi.numberCount = 0
    stockBattleUi.acting = null
    stockBattleUi.targets = {}
    stockBattleUi.targetCount = 0
    stockBattleUi.list = {}
    stockBattleUi.listCount = 0
    if (stockBattle.battleBackgroundDataCache == null) {
      stockBattle.battleBackgroundDataCache = battlebackgrounddata()
    }
    for (party = 0; party < 2; party = party + 1) {
      size = battle.partySize(party)
      for (index = 0; index < size; index = index + 1) {
        fighter = battle.fighter(party, index)
        if (fighter != null) {
          stockBattleUi.roster[stockBattleUi.rosterCount] = fighter
          stockBattleUi.rosterCount = stockBattleUi.rosterCount + 1
          source = "" + fighter.source
          for (slot = 0; slot < 4; slot = slot + 1) {
            stance = stances[slot]
            key = source + "|" + stance
            if (stockBattleUi.files[key] == null) {
              file = fighteranimationfile(fighter, stance)
              if (file == null) {
                file = ""
              }
              stockBattleUi.files[key] = file
              if (file != "") {
                stockBattleUi.preload[stockBattleUi.preloadCount] = file
                stockBattleUi.preloadCount = stockBattleUi.preloadCount + 1
              }
            }
          }
          if (party == 1) {
            stockBattleUi.chars["" + fighter.id] = battlecharacterdata(fighter)
          }
        }
      }
    }
    // Pictures are fetched and decoded by the host, and a first use only queues the fetch. Draw every picture the
    // screen will use once into a one-pixel scratch canvas and wait a few ticks, so that by the first real frame each
    // is cached and every later `bitmap` / `drawenemy` lands in the order the screen draws it.
    scratch = createcanvas(1, 1)
    // `bitmap` decodes PNG, JPEG, BMP and GIF; a tile bitmap (.tbm) background cannot be drawn yet, so the screen
    // shows its flat colour instead.
    stockBattleUi.picture = ""
    if (stockBattle.battleBackgroundDataCache != null) {
      stockBattleUi.picture = stockBattle.battleBackgroundDataCache.image
      if (lcase(right(stockBattleUi.picture, 4)) == ".tbm") {
        stockBattleUi.picture = ""
      }
    }
    if (stockBattleUi.picture != "") {
      bitmap(stockBattleUi.picture, scratch)
    }
    for (slot = 0; slot < stockBattleUi.preloadCount; slot = slot + 1) {
      drawenemy(stockBattleUi.preload[slot], 0, 0, scratch)
    }
    stockBattleUi.hold(4)
    killcanvas(scratch)
    rendernow(1)
    stockBattleUi.screen = cnvrendernow
    stockBattleUi.target = stockBattleUi.screen
    stockBattleUi.buffer = createcanvas(w, h)
    stockBattleUi.on = 1
    stockBattleUi.refresh()
    return 1
  },
  finish: () => {
    if (stockBattleUi.on == 0) {
      return 0
    }
    stockBattleUi.on = 0
    killcanvas(stockBattleUi.buffer)
    killcanvas(stockBattleUi.screen)
    rendernow(0)
    return 0
  },
  // The idle battle loop calls this once per pass, and it must stay a small fraction of the pass's step budget, so it
  // looks at one fighter and one charge bar per pass instead of the whole screen. A change it finds is drawn in full;
  // the turn loops call `refresh` themselves, which looks at everything.
  pass: () => {
    local(fighter)
    local(fill)
    local(size)
    if (stockBattleUi.on == 0) {
      return 0
    }
    fighter = stockBattleUi.roster[stockBattleUi.scan]
    if (fighter.hp + "," + fighter.smp != stockBattleUi.seen["" + stockBattleUi.scan]) {
      stockBattleUi.refresh()
    }
    stockBattleUi.scan = (stockBattleUi.scan + 1) % stockBattleUi.rosterCount
    size = battle.partySize(1)
    if (size > 0) {
      fill = integerMulDiv(battle.chargePercent(1, stockBattleUi.barScan), stockBattleUi.layout.chargeW - 2, 100)
      if (stockBattleUi.bars["" + stockBattleUi.barScan] != fill) {
        stockBattleUi.drawChargeBar(stockBattleUi.barScan, null)
      }
      stockBattleUi.barScan = (stockBattleUi.barScan + 1) % size
    }
    return 0
  },
  box: (x1, y1, x2, y2, r, g, b) => {
    colorrgb(r, g, b)
    fillrect(x1, y1, x2, y2, stockBattleUi.target)
    return 0
  },
  frame: (x1, y1, x2, y2, r, g, b) => {
    colorrgb(r, g, b)
    drawrect(x1, y1, x2, y2, stockBattleUi.target)
    return 0
  },
  words: (x, y, text, size, r, g, b) => {
    colorrgb(r, g, b)
    fontsize(size)
    pixelText(x, y, text, stockBattleUi.target)
    return 0
  },
  // A bar is a dark track, a coloured fill of value/max, and a light border. It keeps no state.
  bar: (x, y, width, height, value, max, r, g, b) => {
    local(fill) = 0
    local(v) = value
    if (v < 0) {
      v = 0
    }
    if (v > max) {
      v = max
    }
    if (max > 0) {
      fill = integerMulDiv(v, width - 2, max)
    }
    stockBattleUi.box(x, y, x + width - 1, y + height - 1, 32, 32, 40)
    if (fill > 0) {
      stockBattleUi.box(x + 1, y + 1, x + fill, y + height - 2, r, g, b)
    }
    stockBattleUi.frame(x, y, x + width - 1, y + height - 1, 200, 200, 210)
    return fill
  },
  fighterSprite: (fighter) => {
    local(stance) = "rest"
    local(file)
    local(source) = "" + fighter.source
    local(loop) = 1
    if (fighter.hp < 1) {
      stance = "die"
      loop = 0
    } else {
      if (stockBattleUi.acting != null) {
        if (stockBattleUi.acting == fighter.id) {
          stance = stockBattleUi.actingStance
        }
      }
    }
    file = stockBattleUi.files[source + "|" + stance]
    if (file == null || file == "") {
      file = stockBattleUi.files[source + "|rest"]
      loop = 1
    }
    if (file == null) {
      file = ""
    }
    return { file: file, loop: loop }
  },
  slotX: (party, index) => {
    local(layout) = stockBattleUi.layout
    if (party == 0) {
      return layout.enemyX + (index % 2) * layout.enemyDX
    }
    return layout.playerX
  },
  slotY: (party, index) => {
    local(layout) = stockBattleUi.layout
    if (party == 0) {
      return layout.enemyY + ((index - (index % 2)) / 2) * layout.enemyDY
    }
    return layout.playerY + index * layout.playerDY
  },
  drawFighter: (party, index, selected) => {
    local(layout) = stockBattleUi.layout
    local(fighter) = battle.fighter(party, index)
    local(x)
    local(y)
    local(file)
    local(size) = layout.sprite
    if (fighter == null) {
      return 0
    }
    local(sprite)
    x = stockBattleUi.slotX(party, index)
    y = stockBattleUi.slotY(party, index)
    sprite = stockBattleUi.fighterSprite(fighter)
    if (sprite.file != "") {
      drawenemy(sprite.file, x, y, stockBattleUi.target, sprite.loop)
    } else {
      stockBattleUi.frame(x, y, x + size - 1, y + size - 1, 120, 120, 130)
    }
    if (selected != 0) {
      stockBattleUi.frame(x - 4, y - 4, x + size + 3, y + size + 3, 255, 224, 64)
      stockBattleUi.frame(x - 5, y - 5, x + size + 4, y + size + 4, 255, 224, 64)
    }
    if (party == 0) {
      if (fighter.hp < 1) {
        stockBattleUi.words(x, y + size + 3, left(fighter.name, 8), 8, 130, 130, 140)
      } else {
        stockBattleUi.words(x, y + size + 3, left(fighter.name, 8), 8, 255, 255, 255)
      }
      stockBattleUi.bar(x, y + size + 14, size, 6, fighter.hp, fighter.maxhp, 220, 64, 56)
    }
    return 0
  },
  drawChargeBar: (index, fighter) => {
    local(layout) = stockBattleUi.layout
    local(y) = layout.rowY + index * layout.rowDY
    local(fill)
    fill = stockBattleUi.bar(layout.chargeX, y, layout.chargeW, layout.barH, battle.chargePercent(1, index), 100, 240, 200, 40)
    stockBattleUi.bars["" + index] = fill
    return 0
  },
  drawRow: (index) => {
    local(layout) = stockBattleUi.layout
    local(fighter) = battle.fighter(1, index)
    local(y) = layout.rowY + index * layout.rowDY
    local(fallen) = 0
    if (fighter == null) {
      return 0
    }
    if (fighter.hp < 1) {
      fallen = 1
    }
    if (fallen != 0) {
      stockBattleUi.words(layout.rowX, y, left(fighter.name, 8), 16, 130, 130, 140)
    } else {
      if (stockBattleUi.menuIndex == index && (stockBattleUi.mode == "command" || stockBattleUi.mode == "list" || stockBattleUi.mode == "target")) {
        // The member whose turn it is.
        stockBattleUi.words(layout.rowX, y, left(fighter.name, 8), 16, 255, 224, 64)
      } else {
        stockBattleUi.words(layout.rowX, y, left(fighter.name, 8), 16, 255, 255, 255)
      }
    }
    stockBattleUi.bar(layout.hpX, y, layout.hpW, layout.barH, fighter.hp, fighter.maxhp, 64, 200, 80)
    stockBattleUi.words(layout.hpX + 4, y + 3, "HP " + fighter.hp + "/" + fighter.maxhp, 8, 255, 255, 255)
    stockBattleUi.bar(layout.smpX, y, layout.smpW, layout.barH, fighter.smp, fighter.maxsmp, 72, 132, 255)
    stockBattleUi.words(layout.smpX + 4, y + 3, "SP " + fighter.smp + "/" + fighter.maxsmp, 8, 255, 255, 255)
    stockBattleUi.drawChargeBar(index, fighter)
    return 0
  },
  drawCommands: () => {
    local(layout) = stockBattleUi.layout
    local(fighter) = battle.fighter(1, stockBattleUi.menuIndex)
    local(labels) = {}
    local(dim) = {}
    local(longest) = 4
    local(row)
    local(x)
    local(y)
    local(width)
    local(data) = stockBattleUi.chars["" + fighter.id]
    local(special) = "Special"
    labels[0] = "Fight"
    if (data != null) {
      if (data.specialname != "") {
        special = data.specialname
      }
    }
    labels[1] = special
    labels[2] = "Items"
    labels[3] = "Run"
    dim[0] = 0
    dim[1] = stockBattleUi.specialsEmpty
    dim[2] = stockBattleUi.itemsEmpty
    dim[3] = 0
    if (stockBattle.canRun() == 0) {
      dim[3] = 1
    }
    for (row = 0; row < 4; row = row + 1) {
      if (len(labels[row]) > longest) {
        longest = len(labels[row])
      }
    }
    width = longest * 16 + 44
    x = (layout.w - width) / 2
    y = (layout.messageY - 4 * layout.menuRowH - 16) / 2
    stockBattleUi.box(x, y, x + width - 1, y + 4 * layout.menuRowH + 15, 12, 16, 40)
    stockBattleUi.frame(x, y, x + width - 1, y + 4 * layout.menuRowH + 15, 180, 190, 255)
    for (row = 0; row < 4; row = row + 1) {
      if (row == stockBattleUi.cursor) {
        stockBattleUi.box(x + 4, y + 8 + row * layout.menuRowH, x + width - 5, y + 8 + row * layout.menuRowH + layout.menuRowH - 2, 40, 64, 140)
        stockBattleUi.words(x + 8, y + 12 + row * layout.menuRowH, ">", 16, 255, 224, 64)
      }
      if (dim[row] != 0) {
        stockBattleUi.words(x + 32, y + 12 + row * layout.menuRowH, labels[row], 16, 110, 110, 120)
        if (row == 3) {
          // A blocked Run is still listed, drawn dim and struck through.
          stockBattleUi.box(x + 32, y + 12 + row * layout.menuRowH + 7, x + 32 + len(labels[row]) * 16, y + 12 + row * layout.menuRowH + 8, 110, 110, 120)
        }
      } else {
        stockBattleUi.words(x + 32, y + 12 + row * layout.menuRowH, labels[row], 16, 255, 255, 255)
      }
    }
    return 0
  },
  drawList: () => {
    local(layout) = stockBattleUi.layout
    local(fighter) = battle.fighter(1, stockBattleUi.menuIndex)
    local(x) = (layout.w - layout.listW) / 2
    local(rows) = stockBattleUi.listCount
    local(row)
    local(entry)
    local(y)
    local(title)
    local(detail)
    local(data) = stockBattleUi.chars["" + fighter.id]
    if (rows > layout.listRows) {
      rows = layout.listRows
    }
    y = (layout.messageY - rows * layout.listRowH - 28) / 2
    title = "Items"
    if (stockBattleUi.listKind == "special") {
      title = "Special"
      if (data != null) {
        if (data.specialname != "") {
          title = data.specialname
        }
      }
    }
    stockBattleUi.box(x, y, x + layout.listW - 1, y + rows * layout.listRowH + 27, 12, 16, 40)
    stockBattleUi.frame(x, y, x + layout.listW - 1, y + rows * layout.listRowH + 27, 180, 190, 255)
    stockBattleUi.words(x + 8, y + 6, title, 8, 180, 190, 255)
    for (row = 0; row < rows; row = row + 1) {
      entry = stockBattleUi.list[stockBattleUi.listTop + row]
      if (stockBattleUi.listTop + row == stockBattleUi.listCursor) {
        stockBattleUi.box(x + 4, y + 20 + row * layout.listRowH, x + layout.listW - 5, y + 20 + row * layout.listRowH + layout.listRowH - 2, 40, 64, 140)
        stockBattleUi.words(x + 8, y + 23 + row * layout.listRowH, ">", 16, 255, 224, 64)
      }
      if (entry.affordable == 0) {
        stockBattleUi.words(x + 28, y + 23 + row * layout.listRowH, left(entry.label, 10), 16, 110, 110, 120)
        stockBattleUi.words(x + layout.listW - 8 - len(entry.detail) * 8, y + 27 + row * layout.listRowH, entry.detail, 8, 110, 110, 120)
      } else {
        stockBattleUi.words(x + 28, y + 23 + row * layout.listRowH, left(entry.label, 10), 16, 255, 255, 255)
        stockBattleUi.words(x + layout.listW - 8 - len(entry.detail) * 8, y + 27 + row * layout.listRowH, entry.detail, 8, 200, 220, 255)
      }
    }
    return 0
  },
  drawNumbers: () => {
    local(index)
    local(entry)
    local(x)
    local(y)
    for (index = 0; index < stockBattleUi.numberCount; index = index + 1) {
      entry = stockBattleUi.numbers[index]
      x = stockBattleUi.slotX(entry.party, entry.index)
      y = stockBattleUi.slotY(entry.party, entry.index)
      if (entry.kind == "damage") {
        stockBattleUi.words(x + 8, y - 4, entry.text, 16, 255, 96, 96)
      }
      if (entry.kind == "heal") {
        stockBattleUi.words(x + 8, y - 4, entry.text, 16, 96, 255, 112)
      }
      if (entry.kind == "smp") {
        stockBattleUi.words(x + 8, y + 12, entry.text, 8, 120, 170, 255)
      }
    }
    return 0
  },
  // The signature is every value the full redraw shows. A pass redraws only when it changed; the charge bars repaint
  // on their own, because a bar's width changes nearly every pass. It samples the engine tick (`battletick()`) modulo 2
  // so that animation frames (which can advance as fast as every 2 to 4 ticks for fast stances) refresh continuously
  // across passes, menus, and hold/action sequences without guessing frame delays.
  // The signature captures all visible battle state. To support arbitrary animation delays (including 1, 2, 3, 5+ ticks)
  // accurately across idle passes, player menus, and action hold sequences without guessing fixed quanta, the signature
  // samples the authoritative engine tick counter `battletick()` during every active interaction and action hold,
  // matching the exact per-animation playback frame.
  currentSignature: () => {
    local(index)
    local(fighter)
    local(tickNow) = 0
    if (stockBattleUi.mode != "idle" || stockBattleUi.acting != null || stockBattleUi.numberCount > 0) {
      tickNow = battletick()
    }
    local(text) = stockBattleUi.mode + ":" + stockBattleUi.cursor + ":" + stockBattleUi.listCursor + ":" + stockBattleUi.listTop + ":" + stockBattleUi.targetCursor + ":" + stockBattleUi.targetParty + ":" + stockBattleUi.numberCount + ":" + stockBattleUi.message + ":" + stockBattleUi.acting + ":" + stockBattleUi.actingStance + ":" + stockBattleUi.listCount + ":" + tickNow
    for (index = 0; index < stockBattleUi.rosterCount; index = index + 1) {
      fighter = stockBattleUi.roster[index]
      stockBattleUi.seen["" + index] = fighter.hp + "," + fighter.smp
      text = text + "|" + stockBattleUi.seen["" + index]
    }
    return text
  },
  refresh: () => {
    local(signature) = stockBattleUi.currentSignature()
    local(size)
    local(index)
    local(fill)
    local(layout) = stockBattleUi.layout
    if (signature != stockBattleUi.signature) {
      stockBattleUi.draw()
      stockBattleUi.signature = signature
      return 1
    }
    size = battle.partySize(1)
    for (index = 0; index < size; index = index + 1) {
      fill = integerMulDiv(battle.chargePercent(1, index), layout.chargeW - 2, 100)
      if (stockBattleUi.bars["" + index] != fill) {
        stockBattleUi.drawChargeBar(index, battle.fighter(1, index))
      }
    }
    return 0
  },
  draw: () => {
    local(layout) = stockBattleUi.layout
    local(party)
    local(index)
    local(size)
    local(selected)
    local(width)
    // A redraw takes several ticks of script steps, so it is composed off screen and shown in one blit.
    stockBattleUi.target = stockBattleUi.buffer
    if (stockBattleUi.picture != "") {
      bitmap(stockBattleUi.picture, stockBattleUi.target)
    } else {
      stockBattleUi.box(0, 0, layout.w - 1, layout.h - 1, 20, 28, 56)
    }
    for (party = 0; party < 2; party = party + 1) {
      size = battle.partySize(party)
      for (index = 0; index < size; index = index + 1) {
        selected = 0
        if (stockBattleUi.mode == "target" && stockBattleUi.targetParty == party) {
          if (stockBattleUi.targets[stockBattleUi.targetCursor] == index) {
            selected = 1
          }
        }
        stockBattleUi.drawFighter(party, index, selected)
      }
    }
    stockBattleUi.box(0, layout.panelY, layout.w - 1, layout.h - 1, 12, 16, 40)
    stockBattleUi.frame(0, layout.panelY, layout.w - 1, layout.h - 1, 180, 190, 255)
    size = battle.partySize(1)
    for (index = 0; index < size; index = index + 1) {
      stockBattleUi.drawRow(index)
    }
    if (stockBattleUi.message != "") {
      stockBattleUi.box(0, layout.messageY, layout.w - 1, layout.messageY + layout.messageH - 1, 12, 16, 40)
      stockBattleUi.frame(0, layout.messageY, layout.w - 1, layout.messageY + layout.messageH - 1, 180, 190, 255)
      stockBattleUi.words(8, layout.messageY + 6, stockBattleUi.message, 8, 255, 255, 255)
    }
    if (stockBattleUi.mode == "command") {
      stockBattleUi.drawCommands()
    }
    if (stockBattleUi.mode == "list") {
      stockBattleUi.drawList()
    }
    stockBattleUi.drawNumbers()
    drawcanvas(stockBattleUi.buffer, 0, 0, layout.w, layout.h, stockBattleUi.screen)
    stockBattleUi.target = stockBattleUi.screen
    return 0
  },
}

// ---- the interaction half of the screen: key mapping, the player's turn and the numbers after an action ----------
stockBattleUi.snapshot = () => {
  local(party)
  local(index)
  local(size)
  local(fighter)
  local(result) = {}
  for (party = 0; party < 2; party = party + 1) {
    size = battle.partySize(party)
    for (index = 0; index < size; index = index + 1) {
      fighter = battle.fighter(party, index)
      if (fighter != null) {
        result["" + party + "_" + index] = { hp: fighter.hp, smp: fighter.smp }
      }
    }
  }
  return result
}

// Compare the battle with the snapshot taken before an action and list what changed as damage numbers: HP lost is
// red, HP gained green, SMP changed blue. Nothing is written to the battle.
stockBattleUi.collectNumbers = (before) => {
  local(party)
  local(index)
  local(size)
  local(fighter)
  local(was)
  local(delta)
  stockBattleUi.numbers = {}
  stockBattleUi.numberCount = 0
  for (party = 0; party < 2; party = party + 1) {
    size = battle.partySize(party)
    for (index = 0; index < size; index = index + 1) {
      fighter = battle.fighter(party, index)
      was = before["" + party + "_" + index]
      if (fighter != null && was != null) {
        delta = fighter.hp - was.hp
        if (delta < 0) {
          stockBattleUi.numbers[stockBattleUi.numberCount] = { party: party, index: index, kind: "damage", text: "" + (0 - delta) }
          stockBattleUi.numberCount = stockBattleUi.numberCount + 1
        }
        if (delta > 0) {
          stockBattleUi.numbers[stockBattleUi.numberCount] = { party: party, index: index, kind: "heal", text: "+" + delta }
          stockBattleUi.numberCount = stockBattleUi.numberCount + 1
        }
        delta = fighter.smp - was.smp
        if (delta != 0) {
          stockBattleUi.numbers[stockBattleUi.numberCount] = { party: party, index: index, kind: "smp", text: "SP " + delta }
          stockBattleUi.numberCount = stockBattleUi.numberCount + 1
        }
      }
    }
  }
  return stockBattleUi.numberCount
}

stockBattleUi.hold = (ticks) => {
  local(tick)
  for (tick = 0; tick < ticks; tick = tick + 1) {
    stockBattleUi.refresh()
    threadSleep(getThreadId(), 1/60)
  }
  return 0
}

// After an action: show its numbers (and the message, when there is one) for a fixed number of ticks, then clear
// them with the message and the stance. An action that changed nothing and says nothing costs no ticks.
stockBattleUi.settle = (before, label) => {
  stockBattleUi.mode = "act"
  stockBattleUi.collectNumbers(before)
  if (stockBattleUi.numberCount > 0 && label != "") {
    stockBattleUi.message = label
  }
  if (stockBattleUi.numberCount > 0 || stockBattleUi.message != "") {
    stockBattleUi.hold(stockBattleUi.layout.numberTicks)
  }
  stockBattleUi.numbers = {}
  stockBattleUi.numberCount = 0
  stockBattleUi.message = ""
  stockBattleUi.acting = null
  stockBattleUi.actingStance = ""
  stockBattleUi.mode = "idle"
  stockBattleUi.refresh()
  return 0
}

stockBattleUi.base = (path) => {
  local(name) = path
  local(slash) = instr(name, "/")
  while (slash > 0) {
    name = mid(name, slash + 1, len(name) - slash)
    slash = instr(name, "/")
  }
  slash = instr(name, "\\")
  while (slash > 0) {
    name = mid(name, slash + 1, len(name) - slash)
    slash = instr(name, "\\")
  }
  name = replace(name, ".spc", "")
  name = replace(name, ".SPC", "")
  name = replace(name, ".itm", "")
  name = replace(name, ".ITM", "")
  return name
}

// The player's Special list: the learned moves whose own battle byte says usable (0), with their SMP cost; one the
// player cannot afford stays listed but dim. The Item list: the available stacks whose item says usable in battle.
stockBattleUi.prepareLists = (fighter) => {
  local(data) = stockBattleUi.chars["" + fighter.id]
  local(slot)
  local(move)
  local(file)
  local(inventory)
  local(index)
  local(stack)
  local(item)
  local(key)
  stockBattleUi.specials = {}
  stockBattleUi.specialCount = 0
  stockBattleUi.items = {}
  stockBattleUi.itemCount = 0
  if (data != null) {
    if (data.hasspecial == 1) {
      for (index = 0; index < data.specialcount; index = index + 1) {
        slot = data.specialmoves[index]
        if (slot.available == 1) {
          file = slot.file
          move = stockBattle.specialDataCache[file]
          if (move == null) {
            move = battlemovedata(file)
            if (move != null) {
              stockBattle.specialDataCache[file] = move
            }
          }
          if (move != null) {
            if (move.battle == 0) {
              stockBattleUi.specials[stockBattleUi.specialCount] = {
                label: stockBattleUi.base(file), detail: "SP " + move.smp, file: file, data: move, affordable: 1
              }
              if (move.smp > fighter.smp) {
                stockBattleUi.specials[stockBattleUi.specialCount].affordable = 0
              }
              stockBattleUi.specialCount = stockBattleUi.specialCount + 1
            }
          }
        }
      }
    }
  }
  inventory = battleinventory()
  for (index = 0; index < inventory.count; index = index + 1) {
    stack = inventory.items[index]
    key = lcase(stack.source)
    item = stockBattleUi.itemData[key]
    if (item == null) {
      item = battleitemdata(stack.source)
      if (item != null) {
        stockBattleUi.itemData[key] = item
      }
    }
    if (item != null) {
      if (item.usable == 1) {
        stockBattleUi.items[stockBattleUi.itemCount] = {
          label: stack.handle, detail: "x" + stack.quantity, file: stack.source, quantity: stack.quantity, data: item, affordable: 1
        }
        stockBattleUi.itemCount = stockBattleUi.itemCount + 1
      }
    }
  }
  stockBattleUi.specialsEmpty = 0
  if (stockBattleUi.specialCount < 1) {
    stockBattleUi.specialsEmpty = 1
  }
  stockBattleUi.itemsEmpty = 0
  if (stockBattleUi.itemCount < 1) {
    stockBattleUi.itemsEmpty = 1
  }
  return 0
}

// Targets, as indexes into one party: living enemies for Fight and Special (a defeated enemy keeps its slot but is
// skipped); every party member, fallen ones included, for Item so a healing item can revive.
stockBattleUi.collectTargets = (kind) => {
  local(party) = 0
  local(index)
  local(size)
  local(fighter)
  stockBattleUi.targets = {}
  stockBattleUi.targetCount = 0
  if (kind == "item") {
    party = 1
  }
  size = battle.partySize(party)
  for (index = 0; index < size; index = index + 1) {
    fighter = battle.fighter(party, index)
    if (fighter != null) {
      if (kind == "item" || fighter.hp > 0) {
        stockBattleUi.targets[stockBattleUi.targetCount] = index
        stockBattleUi.targetCount = stockBattleUi.targetCount + 1
      }
    }
  }
  stockBattleUi.targetParty = party
  stockBattleUi.targetCursor = 0
  return stockBattleUi.targetCount
}

stockBattleUi.openTargets = (kind) => {
  if (stockBattleUi.collectTargets(kind) < 1) {
    stockBattleUi.cue("cant")
    return 0
  }
  stockBattleUi.pendingKind = kind
  stockBattleUi.mode = "target"
  stockBattleUi.cue("choose")
  return 1
}

stockBattleUi.openList = (kind) => {
  if (kind == "special") {
    if (stockBattleUi.specialCount < 1) {
      stockBattleUi.cue("cant")
      return 0
    }
    stockBattleUi.list = stockBattleUi.specials
    stockBattleUi.listCount = stockBattleUi.specialCount
  } else {
    if (stockBattleUi.itemCount < 1) {
      stockBattleUi.cue("cant")
      return 0
    }
    stockBattleUi.list = stockBattleUi.items
    stockBattleUi.listCount = stockBattleUi.itemCount
  }
  stockBattleUi.listKind = kind
  stockBattleUi.listCursor = 0
  stockBattleUi.listTop = 0
  stockBattleUi.mode = "list"
  stockBattleUi.cue("choose")
  return 1
}

// Perform the chosen action on the chosen target through the package's own action functions, then show the numbers.
stockBattleUi.perform = (fighter) => {
  local(target) = battle.fighter(stockBattleUi.targetParty, stockBattleUi.targets[stockBattleUi.targetCursor])
  local(before) = stockBattleUi.snapshot()
  local(kind) = stockBattleUi.pendingKind
  local(entry) = stockBattleUi.pendingEntry
  if (kind == "item") {
    if (entry.quantity < 1 || itemcount(entry.file) < 1) {
      stockBattleUi.cue("cant")
      stockBattleUi.acting = null
      stockBattleUi.actingStance = ""
      stockBattleUi.mode = "target"
      stockBattleUi.refresh()
      return 0
    }
  }
  stockBattleUi.cue("choose")
  stockBattleUi.acting = fighter.id
  stockBattleUi.mode = "act"
  if (kind == "fight") {
    stockBattleUi.actingStance = "fight"
    stockBattleUi.message = fighter.name + " attacks " + target.name
    stockBattleUi.refresh()
    stockBattle.attack(fighter, target)
  }
  if (kind == "special") {
    stockBattleUi.actingStance = "special move"
    stockBattleUi.message = fighter.name + " uses " + entry.label + " on " + target.name
    stockBattleUi.refresh()
    stockBattle.special(fighter, target, entry.file)
  }
  if (kind == "item") {
    stockBattleUi.actingStance = "rest"
    stockBattleUi.message = fighter.name + " uses " + entry.label + " on " + target.name
    stockBattleUi.refresh()
    stockBattle.item(fighter, target, entry.file)
  }
  stockBattleUi.settle(before, "")
  return 1
}

stockBattleUi.isConfirm = (key) => {
  if (key == "ENTER" || key == "SPACE") {
    return 1
  }
  return 0
}

// One key. Returns 1 when the player's turn is over. Up/Down (and Left/Right in targets) move one step; Enter or
// Space confirms; Esc goes back one level and does nothing at the top.
stockBattleUi.handleKey = (fighter, key) => {
  local(mode) = stockBattleUi.mode
  local(entry)
  local(step) = 0
  if (key == "UP" || key == "LEFT") {
    step = -1
  }
  if (key == "DOWN" || key == "RIGHT") {
    step = 1
  }
  if (mode == "command") {
    if (step != 0 && (key == "UP" || key == "DOWN")) {
      stockBattleUi.cursor = (stockBattleUi.cursor + step + 4) % 4
      stockBattleUi.cue("select")
      return 0
    }
    if (stockBattleUi.isConfirm(key) == 1) {
      if (stockBattleUi.cursor == 0) {
        stockBattleUi.openTargets("fight")
        return 0
      }
      if (stockBattleUi.cursor == 1) {
        stockBattleUi.openList("special")
        return 0
      }
      if (stockBattleUi.cursor == 2) {
        stockBattleUi.openList("item")
        return 0
      }
      if (stockBattle.canRun() == 0) {
        // Run is listed but blocked: the cancel sound, and the player keeps the turn and stays in the menu.
        stockBattleUi.cue("cant")
        return 0
      }
      stockBattleUi.cue("choose")
      stockBattle.run()
      return 1
    }
    return 0
  }
  if (mode == "list") {
    if (step != 0 && (key == "UP" || key == "DOWN")) {
      stockBattleUi.listCursor = (stockBattleUi.listCursor + step + stockBattleUi.listCount) % stockBattleUi.listCount
      if (stockBattleUi.listCursor < stockBattleUi.listTop) {
        stockBattleUi.listTop = stockBattleUi.listCursor
      }
      if (stockBattleUi.listCursor >= stockBattleUi.listTop + stockBattleUi.layout.listRows) {
        stockBattleUi.listTop = stockBattleUi.listCursor - stockBattleUi.layout.listRows + 1
      }
      stockBattleUi.cue("select")
      return 0
    }
    if (stockBattleUi.isConfirm(key) == 1) {
      entry = stockBattleUi.list[stockBattleUi.listCursor]
      if (stockBattleUi.listKind == "special") {
        // A special the player cannot afford is refused here: nothing is spent, and the player stays in the menu.
        if (entry.data.smp > fighter.smp) {
          stockBattleUi.cue("cant")
          return 0
        }
        stockBattleUi.pendingEntry = entry
        stockBattleUi.openTargets("special")
        return 0
      }
      stockBattleUi.pendingEntry = entry
      stockBattleUi.openTargets("item")
      return 0
    }
    if (key == "ESC") {
      stockBattleUi.mode = "command"
      stockBattleUi.cue("select")
    }
    return 0
  }
  if (mode == "target") {
    if (step != 0) {
      stockBattleUi.targetCursor = (stockBattleUi.targetCursor + step + stockBattleUi.targetCount) % stockBattleUi.targetCount
      stockBattleUi.cue("select")
      return 0
    }
    if (stockBattleUi.isConfirm(key) == 1) {
      return stockBattleUi.perform(fighter)
    }
    if (key == "ESC") {
      if (stockBattleUi.pendingKind == "fight") {
        stockBattleUi.mode = "command"
      } else {
        stockBattleUi.mode = "list"
      }
      stockBattleUi.cue("select")
    }
    return 0
  }
  return 0
}

stockBattleUi.playerTurn = (index) => {
  local(fighter) = battle.fighter(1, index)
  local(key)
  local(done) = 0
  if (fighter == null) {
    return 0
  }
  clearbuffer()
  stockBattleUi.menuIndex = index
  stockBattleUi.message = ""
  stockBattleUi.prepareLists(fighter)
  stockBattleUi.cursor = 0
  stockBattleUi.mode = "command"
  while (done == 0) {
    stockBattleUi.refresh()
    threadSleep(getThreadId(), 1/60)
    key = get()
    if (key != "") {
      done = stockBattleUi.handleKey(fighter, key)
    }
  }
  stockBattleUi.mode = "idle"
  stockBattleUi.refresh()
  return 0
}

// An enemy's turn is the package's own AI. The screen shows the fighter's fight stance while it acts and the numbers
// of whatever changed afterwards.
stockBattleUi.enemyTurn = (index) => {
  local(fighter) = battle.fighter(0, index)
  local(before)
  local(result)
  if (fighter == null) {
    return stockBattleUi.baseTurn(0, index)
  }
  before = stockBattleUi.snapshot()
  stockBattleUi.acting = fighter.id
  stockBattleUi.actingStance = "fight"
  result = stockBattleUi.baseTurn(0, index)
  stockBattleUi.settle(before, fighter.name + " acts")
  return result
}

stockBattleUi.baseTurn = stockBattle.turn
stockBattle.turn = (party, index) => {
  if (stockBattleUi.on == 0) {
    return stockBattleUi.baseTurn(party, index)
  }
  if (party == 1) {
    return stockBattleUi.playerTurn(index)
  }
  return stockBattleUi.enemyTurn(index)
}

registerPlugin({
  name: "stock_battle",
  commands: {
    battle: (next) => {
      return next()
    },
    fight: (skill, bkg, next) => {
      return next(skill, bkg)
    },
    ai: (level, next) => {
      local(fighter)
      local(data)
      next(level)
      if (level < 0 || level > 3) {
        return 0
      }
      fighter = stockBattle.resolveFighter(sourceHandle())
      if (fighter == null) {
        return 0
      }
      data = stockBattle.enemyData(fighter)
      if (data == null) {
        return 0
      }
      return stockBattle.performAi(fighter, level)
    }
  }
})
