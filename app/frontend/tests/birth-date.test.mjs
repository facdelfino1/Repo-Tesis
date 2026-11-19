import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function load(file, globals) {
    const source = await readFile(new URL(`../assets/js/${file}`, import.meta.url), 'utf8');
    const module = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), { context: vm.createContext(globals) });
    await module.link(() => { throw Error('Unexpected import'); });
    await module.evaluate();
    return module.namespace;
}

test('birth validation rejects manual invalid/future dates and clears errors after correction', async () => {
    let today = '2026-11-18';
    const { validateBirthDate } = await load('components/birth-date.js', { todayInputValue: () => today });
    const input = { setCustomValidity(message) { this.validationMessage = message; } };
    for (const value of ['', 'not-a-date', '18/11/2026', '2025-02-29', '2000-04-31', '0000-01-01', '2026-11-19']) {
        input.value = value;
        assert.ok(validateBirthDate(input), value);
        assert.ok(input.validationMessage);
    }
    for (const value of ['1992-02-29', '2000-02-29', '2026-11-18']) {
        input.value = value;
        assert.equal(validateBirthDate(input), '');
        assert.equal(input.validationMessage, '');
        assert.equal(input.required, true);
        assert.equal(input.max, today);
    }
    today = '2026-11-19';
    input.value = today;
    assert.equal(validateBirthDate(input), '');
    assert.equal(input.max, today);
});

test('birth maximum uses the local calendar day across timezones, not UTC', async () => {
    const originalTimezone = process.env.TZ;
    const NativeDate = Date;
    class FixedDate extends NativeDate {
        constructor(...args) { super(...(args.length ? args : ['2026-11-18T00:30:00Z'])); }
    }
    try {
        for (const [timezone, expected] of [
            ['UTC', '2026-11-18'], ['America/Argentina/Buenos_Aires', '2026-11-17'],
            ['Pacific/Kiritimati', '2026-11-18']
        ]) {
            process.env.TZ = timezone;
            const { todayInputValue } = await load('core/formatters.js', { Date: FixedDate });
            const { validateBirthDate } = await load('components/birth-date.js', { todayInputValue });
            const input = { value: expected, setCustomValidity() {} };
            assert.equal(validateBirthDate(input), '');
            assert.equal(input.max, expected);
        }
    } finally {
        if (originalTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = originalTimezone;
    }
});
