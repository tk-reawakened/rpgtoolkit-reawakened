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
  local(fighters) = {}
  local(done) = 0
  stockBattle.active = 1
  stockBattle.clearDefeatedListeners()
  stockBattle.enemyDataCache = {}
  stockBattle.specialDataCache = {}
  stockBattle.battleBackgroundDataCache = null
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
          party: party, index: index, threshold: threshold, fighter: fighter, files: {}
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
            }
          } else {
            if (charge >= cache.threshold) {
              if (cache.statusCount > 0) {
                battleStatusTurn(fighter, cache)
              }
              // A successful run ends at the next pass boundary: later fighters still tick statuses but do not take turns.
              if (stockBattle.runPending == 0) {
                if (cache.party == 1) {
                  stockBattle.preserveCharge = 0
                  stockBattle.turn(cache.party, cache.index)
                  if (stockBattle.preserveCharge == 0) {
                    battle.releaseCharge(cache.party, cache.index)
                  }
                } else {
                  stockBattle.turn(cache.party, cache.index)
                  battle.releaseCharge(cache.party, cache.index)
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
      threadSleep(getThreadId(), 1/60)
    }
    if (battleDecided() != 0) {
      __battle_apply_outcome(stockBattle.decidedOutcome)
      done = 1
    }
  }
  stockBattle.active = 0
  stockBattle.clearDefeatedListeners()
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
