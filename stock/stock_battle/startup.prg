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

// BAT-4: this hook spends a turn without taking an action. A game or a later
// stock battle module can replace stockBattle.turn with (party, index) => { ... }.
// It runs on the loop's ONE thread; waits keep every fighter's charge parked.
// The loop, not the hook, releases the acting fighter's charge after it returns.
stockBattle = {
  turn: (party, index) => { return 0 },
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
    move = battlemovedata(file)
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
      stockBattle.runProgram(move.program, source, target)
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
      stockBattle.runProgram(data.program, source, target)
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
  // Run a named battle action on this thread and restore its caller context.
  // The optional dictionary adds program data but cannot replace source/target.
  runProgram: (file, source, target, extra) => {
    if (file != "") {
      context = __battle_program_context(source.source, target.source, extra)
      executeProgram(file, context)
    }
    return 0
  }
}

// null is the unset value in RPGCode, but its literal also compares as numeric
// 0 (LEX-9). String context distinguishes unset "" from outcome 0's "0"
// (SEM-3 / SEM-5), so automatic escape is just as decided as every other code.
battleDecided = () => {
  return battle.outcome != ""
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
    cache.order[index] = file
    index = index + 1
    file = getstatus(fighter, index)
  }
  cache.statusCount = index
  for (index = 1; index < cache.statusCount; index = index + 1) {
    file = cache.order[index]
    sortIndex = index - 1
    while (sortIndex >= 0 && battleStatusBefore(file, cache.order[sortIndex])) {
      cache.order[sortIndex + 1] = cache.order[sortIndex]
      sortIndex = sortIndex - 1
    }
    cache.order[sortIndex + 1] = file
  }
  return cache.rate
}

function battleStatusTurn(fighter, cache) {
  local(position) = 0
  local(file)
  local(data)
  while (position < cache.statusCount) {
    file = cache.order[position]
    data = cache.files[ucase(file)]
    if (data.hp != 0 && data.hpamount != 0) {
      __battle_status_delta(fighter, "hp", data.hpamount)
    }
    if (data.smp != 0 && data.smpamount != 0) {
      __battle_status_delta(fighter, "smp", data.smpamount)
    }
    if (data.runprogram != 0) {
      stockBattle.runProgram(data.program, fighter, fighter, { status: file })
    }
    position = position + 1
  }
  if (cache.statusCount > 0) {
    __battle_status_advance(fighter, 1)
  }
}

// The battle section is supplied by the start owner (ticket 7.9). This
// package owns charge, status rounds/effects, and the action thread's turn seam.
// Measured steady idle cost: 75 steps/fighter + 26/pass: eight fighters 626,
// nine 701 of STEP_BUDGET=1000, with no statuses or one cached inert status each.
// Status changes and turns can still preempt; BAT-4 resumes the saved pass.
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
  // BAT-2 fixes the battle's fighter lists. Capture their ordered references
  // and constants once, not mutable HP or status data. Restore keeps these
  // dictionaries and actor handles; it does not rebuild or reseed the battle.
  for (party = 0; party < 2; party = party + 1) {
    threshold = party == 0 ? 123 : 75
    size = battle.partySize(party)
    for (index = 0; index < size; index = index + 1) {
      battle.setCharge(party, index, random(threshold) - 1)
      fighters[count] = {
        party: party, index: index, threshold: threshold,
        fighter: battle.fighter(party, index), files: {}
      }
      count = count + 1
    }
  }
  // Resolve current status assets only after every initial seeded draw.
  for (position = 0; position < count; position = position + 1) {
    cache = fighters[position]
    if (cache.fighter != null) {
      battleStatusRate(cache.fighter, cache)
    }
  }
  threadSleep(getThreadId(), 1/60)
  while (battleDecided() == 0) {
    for (position = 0; position < count; position = position + 1) {
      cache = fighters[position]
      fighter = cache.fighter
      if (fighter != null) {
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
              battleStatusTurn(fighter, cache)
              battle.releaseCharge(cache.party, cache.index)
            } else {
              battle.addCharge(cache.party, cache.index, cache.rate)
            }
          }
        }
      }
    }
    // Even an idle pass must consume one simulated tick. The outcome is checked
    // only between passes: later fighters still finish the pass that decided it.
    threadSleep(getThreadId(), 1/60)
  }
}

registerPlugin({
  name: "stock_battle",
  commands: {
    battle: (next) => {
      return next()
    },
    fight: (skill, bkg, next) => {
      return next(skill, bkg)
    }
  }
})
