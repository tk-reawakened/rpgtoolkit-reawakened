// stock_battle's damage seam is deliberately RPGCode (BAT-5, EMIT-13). Each
// action calls one shared helper from the battle thread, so the cancelable
// dispatch parks that thread before any owner-backed stat write can clamp HP
// or SMP or publish a fallen transition.
localDamage = (request) => {
  local(event)
  local(source)
  local(target)
  local(amount)
  local(pool)
  local(sourceId)
  source = request.source
  target = request.target
  amount = request.amount
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
    damage: amount
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
    total = total + physical({ source: request.source, target: request.first, amount: request.amount })
  }
  if (request.second != null) {
    total = total + physical({ source: request.source, target: request.second, amount: request.amount })
  }
  if (request.third != null) {
    total = total + physical({ source: request.source, target: request.third, amount: request.amount })
  }
  return total
}

drainall = (request) => {
  local(total)
  total = 0
  if (request.first != null) {
    total = total + drain({ source: request.source, target: request.first, amount: request.amount })
  }
  if (request.second != null) {
    total = total + drain({ source: request.source, target: request.second, amount: request.amount })
  }
  if (request.third != null) {
    total = total + drain({ source: request.source, target: request.third, amount: request.amount })
  }
  return total
}

// BAT-4: this hook spends a turn without taking an action. A game or a later
// stock battle module can replace stockBattle.turn with (party, index) => { ... }.
// It runs on the loop's ONE thread; waits keep every fighter's charge parked.
// The loop, not the hook, releases the acting fighter's charge after it returns.
stockBattle = {
  turn: (party, index) => { return 0 }
}

// null is the unset value in RPGCode, but its literal also compares as numeric
// 0 (LEX-9). String context distinguishes unset "" from outcome 0's "0"
// (SEM-3 / SEM-5), so automatic escape is just as decided as every other code.
battleDecided = () => {
  return battle.outcome != ""
}

// Charge contributions only: ticket 7.6 can extend the turn path with effects
// and expiry. Counter presence means active, including an indefinite zero.
// Each fighter owns its own per-battle flag cache in the loop's saved locals.
// Return the rate and refresh cache.disabled (the active disable count), without
// allocating a new result dictionary on every fighter's pass.
// A failed asset read reports its located error once and caches no contribution;
// removing/reapplying a status cannot turn that into a diagnostic every pass.
function battleStatusRate(fighter, cache) {
  local(file) = getstatus(fighter, 0)
  cache.disabled = 0
  if (file == "") {
    return 3
  }
  local(index) = 0
  local(flags)
  local(key)
  local(rate) = 3
  while (file != "") {
    key = ucase(file)
    flags = cache[key]
    if (flags == null) {
      flags = statusflags(file)
      if (flags == null) {
        flags = { speed: 0, slow: 0, disable: 0 }
      }
      cache[key] = flags
    }
    rate = rate + 2 * flags.speed - 2 * flags.slow
    cache.disabled = cache.disabled + flags.disable
    index = index + 1
    file = getstatus(fighter, index)
  }
  return rate
}

// The battle section is supplied by the start owner (ticket 7.9). No enemies,
// actions, outcome decisions, status rounds, presentation or clocks live here.
// A steady idle pass of nine fighters uses 897/1000 VM steps. More statuses or
// turn work can preempt a pass; BAT-4 permits it to resume late, in the same
// saved order next tick, never starting a second pass over unfinished fighters.
function battle() {
  local(party)
  local(index)
  local(size)
  local(threshold)
  local(fighter)
  local(charge)
  local(rate)
  local(cache)
  local(caches) = {}
  for (party = 0; party < 2; party = party + 1) {
    threshold = party == 0 ? 123 : 75
    size = battle.partySize(party)
    for (index = 0; index < size; index = index + 1) {
      battle.setCharge(party, index, random(threshold) - 1)
      caches[party + ":" + index] = {}
    }
  }
  // Resolve existing status assets before the first advance. All definitions
  // are plain VM data, and new files applied later resolve through the same seam.
  for (party = 0; party < 2; party = party + 1) {
    size = battle.partySize(party)
    for (index = 0; index < size; index = index + 1) {
      fighter = battle.fighter(party, index)
      if (fighter != null) {
        battleStatusRate(fighter, caches[party + ":" + index])
      }
    }
  }
  threadSleep(getThreadId(), 1/60)
  while (battleDecided() == 0) {
    for (party = 0; party < 2; party = party + 1) {
      threshold = party == 0 ? 123 : 75
      size = battle.partySize(party)
      for (index = 0; index < size; index = index + 1) {
        fighter = battle.fighter(party, index)
        if (fighter != null) {
          if (fighter.hp > 0) {
            cache = caches[party + ":" + index]
            rate = battleStatusRate(fighter, cache)
            charge = battle.charge(party, index)
            if (cache.disabled > 0) {
              if (charge >= threshold) {
                battle.setCharge(party, index, threshold - 1)
              }
            } else {
              if (charge >= threshold) {
                stockBattle.turn(party, index)
                battle.releaseCharge(party, index)
              } else {
                battle.addCharge(party, index, rate)
              }
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
