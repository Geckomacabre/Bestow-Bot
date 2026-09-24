import { describe, expect, test } from 'bun:test';
import { assertPublicHost, cleanHost, dnsLookup, ipLookup, normalizeWebUrl, parseDoh, parseIpwho, parsePing, ping, reverseName } from '../src/lookups/net';
import { coinPrice, convertCoins, gas, isBtcAddress, isEthAddress, parseBtc, parseCoin, parseEth, pickCoin, satsToBtc, transferCostUsd, usd, wallet, weiToEth } from '../src/lookups/crypto';

const live = Bun.env.RUN_NET_TEST === '1' ? test : test.skip;

describe('host/url cleaning', () => {
  test('cleanHost normalises hosts, URLs and ports', () => {
    const cases: [string, string][] = [['Example.COM', 'example.com'], ['https://example.com/path?q=1#x', 'example.com'], ['http://user:pw@example.com:8080/x', 'example.com'], ['example.com:443', 'example.com'],
      ['example.com.', 'example.com'], ['1.1.1.1', '1.1.1.1'], ['http://1.1.1.1:80/', '1.1.1.1'], ['[2606:4700:4700::1111]', '2606:4700:4700::1111'], ['http://[2606:4700:4700::1111]:80/', '2606:4700:4700::1111'], ['sub.domain.co.uk', 'sub.domain.co.uk']];
    for (const [i, want] of cases) expect(cleanHost(i), i).toBe(want);
    for (const bad of ['', 'nodots', 'exa mple.com', '-bad-.com', 'a..b.com', 'x'.repeat(300) + '.com', '999.999.999.999x', 'http://', 'javascript:alert(1)//x']) expect(() => cleanHost(bad), bad).toThrow();
  });
  test('private hosts are refused, public ones pass', () => {
    for (const h of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', 'localhost.local', 'db.internal', 'nas.home', 'x.lan']) expect(() => assertPublicHost(h), h).toThrow(/private/);
    for (const h of ['8.8.8.8', 'example.com', '2606:4700:4700::1111', 'internal-tools.example.com']) expect(() => assertPublicHost(h), h).not.toThrow();
  });
  test('normalizeWebUrl adds https, and rejects non-web / private / credentialed URLs', () => {
    expect(normalizeWebUrl('example.com')).toBe('https://example.com/');
    expect(normalizeWebUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
    for (const bad of ['file:///etc/passwd', 'ftp://example.com', 'http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/latest', 'https://user:pass@example.com', 'http://[::1]/', 'javascript:alert(1)', 'not a url', 'http://router.local/', 'nodots'])
      expect(() => normalizeWebUrl(bad), bad).toThrow();
  });
  test('reverse DNS names', () => {
    expect(reverseName('1.2.3.4')).toBe('4.3.2.1.in-addr.arpa');
    expect(reverseName('2001:db8::1')).toBe('1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa');
    expect(() => reverseName('nope')).toThrow();
  });
});

describe('parsers (captured response shapes)', () => {
  test('DoH answers, TXT unquoting and NXDOMAIN', () => {
    const a = parseDoh('example.com', 'A', { Status: 0, AD: true, Answer: [{ name: 'example.com', type: 1, TTL: 249, data: '172.66.147.243' }, { name: 'example.com', type: 1, TTL: 249, data: '104.20.23.154' }] });
    expect(a.status).toBe('NOERROR'); expect(a.records.map(r => r.data)).toEqual(['172.66.147.243', '104.20.23.154']); expect(a.dnssec).toBe(true);
    expect(parseDoh('x.com', 'TXT', { Status: 0, Answer: [{ name: 'x.com', type: 16, TTL: 1, data: '"v=spf1 include:a.com" " ~all"' }] }).records[0]!.data).toBe('v=spf1 include:a.com ~all');
    const nx = parseDoh('nope.example', 'A', { Status: 3 });
    expect(nx.status).toBe('NXDOMAIN'); expect(nx.records).toEqual([]);
    expect(parseDoh('x', 'A', { Status: 2 }).status).toBe('SERVFAIL');
    expect(parseDoh('x', 'A', { Status: 99 }).status).toBe('RCODE 99');
  });
  test('ipwho success and failure', () => {
    const r = parseIpwho({ success: true, ip: '1.1.1.1', type: 'IPv4', country: 'Australia', country_code: 'AU', region: 'Queensland', city: 'Brisbane', latitude: -27.47, longitude: 153.03, flag: { emoji: '🇦🇺' },
      connection: { asn: 13335, org: 'Apnic', isp: 'Cloudflare, Inc.', domain: 'cloudflare.com' }, timezone: { id: 'Australia/Brisbane', utc: '+10:00' } });
    expect(r).toMatchObject({ ip: '1.1.1.1', city: 'Brisbane', asn: 13335, isp: 'Cloudflare, Inc.', timezone: 'Australia/Brisbane' });
    expect(() => parseIpwho({ success: false, message: 'Invalid IP address', ip: 'x', type: '' })).toThrow(/valid IP/);
    expect(() => parseIpwho({ success: false, message: 'Reserved range', ip: 'x', type: '' })).toThrow(/couldn't/);
  });
  test('check-host ping results: averages, loss, and nodes still running are skipped', () => {
    const nodes = { 'at1': ['at', 'Austria', 'Vienna'], 'ir6': ['ir', 'Iran', 'Qom'], 'tr1': ['tr', 'Turkey', 'Istanbul'], 'de1': ['de', 'Germany', 'Frankfurt'] } as never;
    const out = parsePing(nodes, {
      at1: [[['OK', 0.0006, '8.6.112.0'], ['OK', 0.0004], ['OK', 0.0005], ['OK', 0.0007]]],
      ir6: [[['OK', 0.08], ['TIMEOUT', 3], ['OK', 0.082], ['TIMEOUT', 3]]],
      tr1: [[['TIMEOUT', 3], ['TIMEOUT', 3], ['TIMEOUT', 3], ['TIMEOUT', 3]]],
      de1: null,
    });
    expect(out.map(n => n.node)).toEqual(['at1', 'ir6', 'tr1']);
    expect(out[0]).toMatchObject({ sent: 4, ok: 4, ip: '8.6.112.0' }); expect(out[0]!.avgMs).toBeCloseTo(0.55, 2);
    expect(out[1]).toMatchObject({ sent: 4, ok: 2 }); expect(out[1]!.avgMs).toBeCloseTo(81, 0);
    expect(out[2]).toMatchObject({ ok: 0, avgMs: undefined });
  });
});

describe('crypto parsers', () => {
  test('address validation', () => {
    for (const a of ['bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy']) expect(isBtcAddress(a), a).toBe(true);
    for (const a of ['', '0xabc', 'bc1', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNO', '../../etc/passwd', 'bc1q/../x'.padEnd(40, 'a')]) expect(isBtcAddress(a), a).toBe(false);
    expect(isEthAddress('0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe')).toBe(true);
    for (const a of ['0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BA', '0xzz0B295669a9FD93d5F28D9Ec85E40f4cb697BAe', 'de0B295669a9FD93d5F28D9Ec85E40f4cb697BAe', '0x' + '1'.repeat(41)]) expect(isEthAddress(a), a).toBe(false);
  });
  test('exact integer money formatting (no float drift)', () => {
    expect(satsToBtc(100_000_000)).toBe('1.00000000'); expect(satsToBtc(1)).toBe('0.00000001'); expect(satsToBtc(0)).toBe('0.00000000'); expect(satsToBtc(-150_000_000)).toBe('-1.50000000');
    expect(satsToBtc(2_100_000_000_000_000)).toBe('21000000.00000000');
    expect(weiToEth('5774491790776062094343')).toBe('5774.491791'); expect(weiToEth('0')).toBe('0'); expect(weiToEth('1000000000000000000')).toBe('1');
    expect(weiToEth('1')).toBe('0'); expect(weiToEth('1500000000000000')).toBe('0.0015'); expect(weiToEth('123456789012345678901234567890')).toBe('123456789012.345679');
  });
  test('BTC wallet balance is confirmed + mempool; blockstream sample', () => {
    const w = parseBtc('addr', { chain_stats: { funded_txo_sum: 5_747_543_403, spent_txo_sum: 0, tx_count: 66569 }, mempool_stats: { funded_txo_sum: 5915, spent_txo_sum: 0, tx_count: 5 } }, 80_000);
    expect(w.balance).toBe('57.47549318 BTC'); expect(w.txCount).toBe(66574); expect(w.usdValue).toBeCloseTo(57.47549318 * 80_000, 2);
    expect(w.extra.some(([k]) => k === 'Unconfirmed')).toBe(true);
    const spent = parseBtc('a', { chain_stats: { funded_txo_sum: 100, spent_txo_sum: 100, tx_count: 2 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } });
    expect(spent.balance).toBe('0.00000000 BTC'); expect(spent.usdValue).toBeUndefined(); expect(spent.extra.some(([k]) => k === 'Unconfirmed')).toBe(false);
  });
  test('ETH wallet parse, including scam flag and null balances', () => {
    const w = parseEth('0x1', { coin_balance: '5774491790776062094343', exchange_rate: '2685.37', is_contract: true, ens_domain_name: null }, { transactions_count: '3274', token_transfers_count: '8376170' });
    expect(w.balance).toBe('5774.491791 ETH'); expect(w.usdValue).toBeCloseTo(5774.491790776 * 2685.37, 0); expect(w.txCount).toBe(3274);
    expect(w.extra).toContainEqual(['Type', 'Smart contract']); expect(w.extra).toContainEqual(['Token transfers', '8,376,170']);
    const empty = parseEth('0x2', { coin_balance: null, is_scam: true }, {});
    expect(empty.balance).toBe('0 ETH'); expect(empty.extra.some(([k]) => k.includes('Flagged'))).toBe(true);
  });
  test('coin picking prefers exact ticker/name matches by market-cap rank', () => {
    const coins = [{ id: 'fake-eth', name: 'Ethereum Fake', symbol: 'ETH', market_cap_rank: 900 }, { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', market_cap_rank: 2 }, { id: 'ethereum-classic', name: 'Ethereum Classic', symbol: 'ETC', market_cap_rank: 30 }];
    expect(pickCoin('eth', coins)).toBe('ethereum'); expect(pickCoin('Ethereum Classic', coins)).toBe('ethereum-classic'); expect(pickCoin('etc', coins)).toBe('ethereum-classic');
    expect(pickCoin('zzz', coins)).toBe('fake-eth'); expect(pickCoin('x', [])).toBeUndefined();
  });
  test('coin parse + money/percent formatting', () => {
    const c = parseCoin({ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 84313, market_cap_rank: 1, price_change_percentage_24h: -0.17, price_change_percentage_7d_in_currency: 10.3, max_supply: 21e6 });
    expect(c).toMatchObject({ symbol: 'BTC', price: 84313, rank: 1, change24h: -0.17, change7d: 10.3 });
    expect(usd(84313)).toBe('$84,313'); expect(usd(1.5)).toBe('$1.50'); expect(usd(0.000012345)).toBe('$0.0000123'); expect(usd(0)).toBe('$0'); expect(usd(null)).toBe('—'); expect(usd(NaN)).toBe('—');
    expect(transferCostUsd(20, 2685)).toBeCloseTo(1.1277, 3);
  });
  test('bad wallet / coin input never reaches the network', async () => {
    await expect(wallet('hello')).rejects.toThrow(/Bitcoin or Ethereum/);
    await expect(coinPrice('$$$ drop table')).rejects.toThrow(/coin name/);
    await expect(convertCoins(-1, 'btc', 'eth')).rejects.toThrow(/amount/);
    await expect(convertCoins(NaN, 'btc', 'eth')).rejects.toThrow(/amount/);
    await expect(ipLookup('127.0.0.1')).rejects.toThrow(/private/);
    await expect(ping('192.168.1.1')).rejects.toThrow(/private/);
    await expect(dnsLookup('1.1.1.1', 'A')).rejects.toThrow(/PTR/);
  });
});

describe('live endpoints (RUN_NET_TEST=1)', () => {
  live('DNS: A, MX, NXDOMAIN and reverse PTR', async () => {
    expect((await dnsLookup('example.com', 'A')).records.length).toBeGreaterThan(0);
    expect((await dnsLookup('gmail.com', 'MX')).records.some(r => r.type === 'MX')).toBe(true);
    expect((await dnsLookup('this-does-not-exist-zzqq.invalid', 'A')).status).toBe('NXDOMAIN');
    expect((await dnsLookup('1.1.1.1', 'PTR')).records[0]?.data).toContain('one.one.one.one');
  }, 30_000);
  live('IP: by address and by domain', async () => {
    expect((await ipLookup('1.1.1.1')).isp).toMatch(/Cloudflare/i);
    const d = await ipLookup('example.com');
    expect(d.resolvedFrom).toBe('example.com'); expect(d.country).toBeTruthy();
  }, 30_000);
  live('ping via check-host', async () => {
    const r = await ping('example.com');
    expect(r.nodes.length).toBeGreaterThan(0); expect(r.nodes.some(n => n.ok > 0)).toBe(true); expect(r.link).toMatch(/check-host/);
  }, 60_000);
  live('coin price, conversion, wallets and fees', async () => {
    const btc = await coinPrice('btc');
    expect(btc.id).toBe('bitcoin'); expect(btc.price).toBeGreaterThan(1000);
    const c = await convertCoins(1, 'bitcoin', 'ethereum');
    expect(c.result).toBeGreaterThan(1);
    const eth = await wallet('0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe');
    expect(eth.chain).toBe('ETH'); expect(eth.txCount).toBeGreaterThan(0);
    const b = await wallet('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
    expect(b.chain).toBe('BTC'); expect(b.txCount).toBeGreaterThan(1000);
    const g = await gas();
    expect(g.btc?.fastest).toBeGreaterThan(0); expect(g.eth?.average).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
