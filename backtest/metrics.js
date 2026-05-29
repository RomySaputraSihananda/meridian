/**
 * Compute backtest performance metrics from a list of trade results.
 * Each result: { net_pnl_pct, fees_sol, il_usd, candles_total, candles_in_range }
 */
export function computeMetrics(trades) {
  if (!trades.length) return { trades: 0 };

  const wins   = trades.filter((t) => t.net_pnl_pct > 0);
  const losses = trades.filter((t) => t.net_pnl_pct <= 0);

  const winRate  = wins.length / trades.length;
  const avgWin   = wins.length   ? wins.reduce((s, t) => s + t.net_pnl_pct, 0)   / wins.length   : 0;
  const avgLoss  = losses.length ? losses.reduce((s, t) => s + t.net_pnl_pct, 0) / losses.length : 0;
  const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;

  // Max drawdown: largest peak-to-trough in cumulative PnL
  let peak = 0;
  let cumPnl = 0;
  let maxDrawdown = 0;
  for (const t of trades) {
    cumPnl += t.net_pnl_pct;
    if (cumPnl > peak) peak = cumPnl;
    const drawdown = peak - cumPnl;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const totalNetPnlPct = trades.reduce((s, t) => s + t.net_pnl_pct, 0);
  const totalFeesSol   = trades.reduce((s, t) => s + (t.fees_sol ?? 0), 0);

  return {
    trades:             trades.length,
    win_rate:           parseFloat(winRate.toFixed(4)),
    avg_win_pct:        parseFloat(avgWin.toFixed(4)),
    avg_loss_pct:       parseFloat(avgLoss.toFixed(4)),
    expectancy_pct:     parseFloat(expectancy.toFixed(4)),
    total_net_pnl_pct:  parseFloat(totalNetPnlPct.toFixed(4)),
    total_fees_sol:     parseFloat(totalFeesSol.toFixed(6)),
    max_drawdown_pct:   parseFloat(maxDrawdown.toFixed(4)),
  };
}
