import fs from "fs";
import { log } from "./logger.js";

let _stats = {
  date: new Date().toDateString(),
  dailyLossSol: 0,
  dailyGainSol: 0,
  consecutiveLosses: 0,
  tradesCount: 0,
};

function maybeResetForNewDay() {
  const today = new Date().toDateString();
  if (_stats.date !== today) {
    _stats = { date: today, dailyLossSol: 0, dailyGainSol: 0, consecutiveLosses: 0, tradesCount: 0 };
  }
}

/** Reset daily loss/gain/consecutive-loss counters and update date. */
export function resetDailyStats() {
  _stats = { date: new Date().toDateString(), dailyLossSol: 0, dailyGainSol: 0, consecutiveLosses: 0, tradesCount: 0 };
}

/** Record a trade's PnL and update win/loss streak counters. @param {{pnlSol: number}} - Trade result with PnL in SOL */
export function recordTrade({ pnlSol }) {
  maybeResetForNewDay();
  _stats.tradesCount++;
  if (pnlSol < 0) {
    _stats.dailyLossSol += Math.abs(pnlSol);
    _stats.consecutiveLosses++;
  } else {
    _stats.dailyGainSol += pnlSol;
    _stats.consecutiveLosses = 0;
  }
}

/**
 * Check circuit breakers before deploying or trading.
 * @param {{ risk: { maxDailyLossSol?: number, maxConsecutiveLosses?: number } }} cfg
 * @returns {{ blocked: boolean, reason: string|null }}
 */
export function checkCircuitBreakers(cfg) {
  maybeResetForNewDay();

  if (process.env.MERIDIAN_KILL_SWITCH === "1" || fs.existsSync(".kill")) {
    return { blocked: true, reason: "global kill-switch active" };
  }

  const maxDailyLoss = cfg?.risk?.maxDailyLossSol ?? Infinity;
  if (_stats.dailyLossSol >= maxDailyLoss) {
    return {
      blocked: true,
      reason: `daily loss ${_stats.dailyLossSol.toFixed(3)} SOL >= limit ${maxDailyLoss} SOL`,
    };
  }

  const maxConsecutive = cfg?.risk?.maxConsecutiveLosses ?? Infinity;
  if (_stats.consecutiveLosses >= maxConsecutive) {
    return {
      blocked: true,
      reason: `${_stats.consecutiveLosses} consecutive losses >= limit ${maxConsecutive}`,
    };
  }

  return { blocked: false, reason: null };
}

/** Get a copy of current daily loss/gain statistics. @returns {{date: string, dailyLossSol: number, dailyGainSol: number, consecutiveLosses: number, tradesCount: number}} */
export function getDailyStats() {
  maybeResetForNewDay();
  return { ..._stats };
}
