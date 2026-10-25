import { atom, read, update } from 'claude-code';
import { baselineFor, computePace, dayKey, parseWorkdays, planRows } from './pace';
const cells = atom({ plugin: 'power-cells', key: 'cells' }, [], { shape: 'cells-1' });
const isHidden = atom({ plugin: 'power-cells', key: 'isHidden' }, false, {
    shape: 'hidden-1',
});
const week = atom({ plugin: 'power-cells', key: 'week' }, null, { shape: 'week-1' });
const WARN_AT = [20, 10, 5];
const RATION_WARN_AT = [80, 100];
const NAMES = {
    five_hour: 'Shields (5h)',
    seven_day: 'Reactor (7d)',
    spend_limit: 'Credits',
};
const compact = (n) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
const bar = (percent, width) => {
    const full = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width);
    return '█'.repeat(full) + '░'.repeat(width - full);
};
const colorFor = (percentLeft) => percentLeft > 40 ? 'green' : percentLeft > 15 ? 'yellow' : 'red';
const until = (iso) => {
    if (!iso)
        return '';
    const mins = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000));
    if (mins >= 1440)
        return ` · resets ${Math.round(mins / 1440)}d`;
    if (mins >= 60)
        return ` · resets ${Math.floor(mins / 60)}h${mins % 60}m`;
    return ` · resets ${mins}m`;
};
const measure = (context, limits) => {
    const out = [];
    if (context.percent !== undefined && context.tokens !== undefined) {
        out.push({
            label: 'Holocron (context)',
            percentLeft: 100 - context.percent,
            detail: `${compact(Math.max(0, context.window - context.tokens))} tokens left`,
        });
    }
    for (const limit of limits) {
        out.push({
            label: NAMES[limit.kind] ?? limit.kind,
            percentLeft: Math.max(0, 100 - limit.percentUsed),
            detail: `${Math.max(0, 100 - limit.percentUsed).toFixed(0)}% left${until(limit.resetsAt)}`,
        });
    }
    return out;
};
export const register = (on, options) => {
    const cfg = {
        workdays: parseWorkdays(String(options.workdays ?? 'mon,tue,wed,thu,fri')),
        workWeight: Math.max(0.1, Number(options.workWeight ?? 2) || 2),
    };
    // Tracks where today's counting starts (kept across sessions) and speaks up at the day's milestones.
    const trackDay = async ($, limits) => {
        const limit = limits.find(one => one.kind === 'seven_day');
        const windowEnd = limit?.resetsAt ? Date.parse(limit.resetsAt) : NaN;
        if (!limit || Number.isNaN(windowEnd)) {
            await update($, week, () => null);
            return;
        }
        const now = Date.now();
        const today = dayKey(now);
        const saved = (await $.store.get('day-1'));
        const isSameDay = saved !== undefined && saved.date === today && Math.abs(saved.windowEnd - windowEnd) < 3600000;
        const record = isSameDay
            ? saved
            : { date: today, windowEnd, baseline: baselineFor(now, windowEnd, limit.percentUsed), toasts: [] };
        const window = { windowEnd, baseline: record.baseline, percentUsed: limit.percentUsed };
        const pace = computePace(now, window, cfg);
        await update($, week, () => window);
        if (!pace)
            return;
        if (!isSameDay) {
            $.ui.toast(`Rations: ${pace.budget.toFixed(1)}% today (${pace.isWork ? 'work day' : 'off day'}), ${(100 - limit.percentUsed).toFixed(0)}% left for ${pace.daysLeft.toFixed(1)} days.`);
        }
        const crossed = RATION_WARN_AT.filter(t => pace.budget > 0 && (pace.used / pace.budget) * 100 >= t && !record.toasts.includes(t));
        for (const t of crossed) {
            $.ui.toast(t >= 100
                ? `Rations: today's ${pace.budget.toFixed(1)}% is spent. Tomorrow's cells are being borrowed.`
                : `Rations: ${t}% of today's ${pace.budget.toFixed(1)}% used.`);
        }
        if (!isSameDay || crossed.length > 0) {
            await $.store.set('day-1', { ...record, toasts: [...record.toasts, ...crossed] });
        }
    };
    // Lowest threshold already warned about, per gauge; a recharge re-arms it.
    const warned = new Map();
    on('session.start', async ($, e, next) => {
        const usage = await $.session.usage();
        await update($, cells, () => measure(usage.context, usage.rateLimits));
        await trackDay($, usage.rateLimits);
        await $.command.register({
            name: 'power',
            description: 'Show or hide the Power Cells gauge; "/power plan" shows the week\'s daily rations',
        });
        return next(e);
    });
    on('command.run', { command: 'power' }, async ($, e) => {
        if (String(e.args ?? '').trim().toLowerCase() === 'plan') {
            const window = await read($, week);
            const rows = window ? planRows(Date.now(), window, cfg) : [];
            if (rows.length === 0) {
                return { text: 'No weekly limit reported yet. It appears after the first reply on a subscription account.' };
            }
            const lines = rows.map(row => `| ${row.label}${row.isToday ? ' (today)' : ''} | ${row.isWork ? 'work' : 'off'} | ${row.budget.toFixed(1)}% | ${row.isToday ? `${row.used.toFixed(1)}%` : ''} |`);
            return {
                text: ['| Day | Type | Ration | Used |', '|---|---|---|---|', ...lines].join('\n'),
            };
        }
        const hidden = !(await read($, isHidden));
        await update($, isHidden, () => hidden);
        return { text: hidden ? 'Power Cells hidden.' : 'Power Cells shown.' };
    });
    on('session.measure', async ($, e, next) => {
        const list = measure(e.context, e.rateLimits);
        await update($, cells, () => list);
        await trackDay($, e.rateLimits);
        for (const cell of list) {
            const last = warned.get(cell.label) ?? 101;
            if (cell.percentLeft > (WARN_AT[0] ?? 20)) {
                warned.delete(cell.label);
                continue;
            }
            const crossed = WARN_AT.filter(t => cell.percentLeft <= t && t < last).sort((a, b) => a - b)[0];
            if (crossed !== undefined) {
                warned.set(cell.label, crossed);
                $.ui.toast(`Power Cells: ${cell.label} at ${cell.percentLeft.toFixed(0)}%. Low on power, we are.`);
            }
        }
        return next(e);
    });
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
        const list = await read($, cells);
        if (e.props.hasSurvey || list.length === 0 || (await read($, isHidden)))
            return next(e);
        const { Box, Text } = $.ui.resolve(e);
        const columns = e.props.bodyColumns ?? 80;
        const width = columns >= 100 ? 10 : 6;
        const window = await read($, week);
        const pace = window ? computePace(Date.now(), window, cfg) : null;
        const ratio = pace && pace.budget > 0 ? pace.used / pace.budget : 0;
        const delta = pace ? pace.weekUsed - pace.expected : 0;
        return (<Box flexDirection="column">
        <Box flexWrap="wrap">
          {list.map(cell => (<Box key={cell.label} marginRight={2}>
              <Text dimColor>{columns >= 70 ? cell.label : cell.label.split(' ')[0]} </Text>
              <Text color={colorFor(cell.percentLeft)}>{bar(cell.percentLeft, width)} </Text>
              <Text dimColor>{cell.detail}</Text>
            </Box>))}
        </Box>
        {pace && (<Box flexWrap="wrap">
            <Box marginRight={2}>
              <Text dimColor>{columns >= 70 ? 'Ration (today)' : 'Today'} </Text>
              <Text color={ratio >= 1 ? 'red' : ratio >= 0.85 ? 'yellow' : 'green'}>
                {bar(ratio * 100, width)}{' '}
              </Text>
              <Text dimColor>
                {pace.used.toFixed(1)} / {pace.budget.toFixed(1)}% · {pace.isWork ? 'work day' : 'off day'}
              </Text>
            </Box>
            <Box marginRight={2}>
              <Text color={delta > 4 ? 'red' : delta < -4 ? 'cyan' : 'green'}>
                {delta > 4
                    ? `${delta.toFixed(0)}% over plan, ease off`
                    : delta < -4
                        ? `${(-delta).toFixed(0)}% under plan, room to use more`
                        : 'on plan'}
              </Text>
            </Box>
            <Text dimColor>
              {pace.daysLeft.toFixed(1)}d left · {pace.perDay.toFixed(1)}%/day avg
            </Text>
          </Box>)}
      </Box>);
    });
};
