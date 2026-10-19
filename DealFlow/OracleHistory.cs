using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;

namespace DealFlow
{
    public class HistoryUnavailableException : Exception
    {
        public HistoryUnavailableException(string message) : base(message) { }
    }

    public class HistoryEvent
    {
        public long Id { get; set; }
        public string Profile { get; set; }
        public string Lender { get; set; }
        public string Product { get; set; }
        public string Code { get; set; }
        public string Name { get; set; }
        public DateTime At { get; set; }
        public string Originator { get; set; }
        public bool Current { get; set; }
    }

    public class HistoryBatch
    {
        public List<HistoryEvent> Events { get; set; } = new List<HistoryEvent>();
        public DateTime ObservedAt { get; set; }
        public bool Sampled { get; set; }
    }

    public class OracleHistory
    {
        private readonly IConfiguration m_config;
        private readonly IMemoryCache m_cache;
        private readonly SemaphoreSlim m_slots = new SemaphoreSlim(2);
        private const string DateFormat = "yyyy-MM-dd HH:mm:ss";
        private const string EventSelect = @"select 'E|' || a.applicationid || '|' || a.applicationprofileid || '|' || a.lenderid || '|' || a.productid || '|' || s.namekey || '|' || replace(s.nameenglish,'|','/') || '|' || to_char(a.creationdate,'YYYY-MM-DD HH24:MI:SS') || '|' || a.originator || '|' || a.new from dtcn.application_dtcan a join dtcn.applicationstatus s on s.applicationstatusid=a.laststatusid ";

        public OracleHistory(IConfiguration config, IMemoryCache cache)
        {
            m_config = config;
            m_cache = cache;
        }

        private string Password => Environment.GetEnvironmentVariable("DEALFLOW_ORACLE_PASSWORD") ?? m_config["Oracle:Password"];
        public bool IsConfigured => !string.IsNullOrEmpty(Password);
        public int CohortLimit => Math.Max(10, Math.Min(2000, m_config.GetValue<int>("Oracle:CohortLimit", 500)));

        public async Task<object> Catalog(CancellationToken token)
        {
            var lines = await Query("select 'S|' || applicationstatusid || '|' || namekey || '|' || replace(nameenglish,'|','/') || '|' || replace(namefrench,'|','/') || '|' || active || '|' || ordinal from dtcn.applicationstatus order by ordinal,applicationstatusid;", token).ConfigureAwait(false);
            return lines.Where(l => l.StartsWith("S|", StringComparison.Ordinal)).Select(l => l.Split('|')).Select(p => new { id = p[1], code = p[2], name = p[3], french = p[4], active = p[5] == "Y", ordinal = p[6] }).ToList();
        }

        public async Task<object> Recent(CancellationToken token)
        {
            var lines = await Query(@"select 'R|' || applicationprofileid || '|' || lenderid || '|' || productid || '|' || namekey || '|' || to_char(creationdate,'YYYY-MM-DD HH24:MI:SS') from (select a.applicationprofileid,a.lenderid,a.productid,s.namekey,a.creationdate from dtcn.application_dtcan a join dtcn.applicationstatus s on s.applicationstatusid=a.laststatusid where a.new='Y' and a.creationdate > sysdate - 30 order by a.creationdate desc,a.applicationid desc) where rownum <= 15;", token).ConfigureAwait(false);
            return lines.Where(l => l.StartsWith("R|", StringComparison.Ordinal)).Select(l => l.Split('|')).Select(p => new { dealId = p[1], lender = p[2], product = p[3], status = p[4], at = p[5] }).ToList();
        }

        public async Task<HistoryBatch> Find(string id, CancellationToken token)
        {
            // Profile IDs take precedence. Application IDs resolve only if no profile matches.
            var filter = "where a.applicationprofileid='" + id + "' or a.applicationprofileid in (select x.applicationprofileid from dtcn.application_dtcan x where x.applicationid=" + id + " and not exists (select 1 from dtcn.applicationprofile p where p.applicationprofileid='" + id + "'))";
            return Parse(await Query(EventSelect + filter + " order by a.creationdate,a.applicationid;", token).ConfigureAwait(false));
        }

        public async Task<List<DealNote>> Notes(string profile, string lender, string product, CancellationToken token)
        {
            var profileLiteral = "'" + profile.Replace("'", "''") + "'";
            var lenderLiteral = "'" + lender.Replace("'", "''") + "'";
            var productLiteral = "'" + product.Replace("'", "''") + "'";
            // The same two message sources used by the legacy notes screen.
            // JSON preserves CLOB text, line breaks, quotes, and delimiters.
            var sql = @"with notes as (
                select 'LENDCOM.NOTE' source, n.noteid id,
                    to_char(n.createdon,'YYYY-MM-DD""T""HH24:MI:SS') at,
                    n.originator actor,
                    nvl(n.sendername,case when n.originator='L' then l.lendername when n.originator='D' then 'Dealer' else 'System' end) sender,
                    n.subject subject, n.text body
                from lendcom.note n
                left join dtcn.lenderlist l on l.lenderid=n.lenderid
                where n.applicationprofileid=" + profileLiteral + " and n.lenderid=" + lenderLiteral + " and n.productid=" + productLiteral + @"
                union all
                select 'APPLICATIONNOTE', to_char(n.noteid),
                    to_char(n.notedatetime,'YYYY-MM-DD""T""HH24:MI:SS'),
                    case when n.fordealer='Y' then 'L' when n.fordealer='N' then 'D' else 'S' end,
                    nvl(n.creatoruser,case when n.fordealer='Y' then l.lendername when n.fordealer='N' then 'Dealer' else 'System' end),
                    null, n.notedescription
                from dtcn.applicationnote n
                left join dtcn.lenderlist l on l.lenderid=n.lenderid
                where n.applicationprofileid=" + profileLiteral + " and n.lenderid=" + lenderLiteral + " and n.productid=" + product + @"
            )
            select json_arrayagg(json_object(
                'source' value source, 'id' value id, 'at' value at,
                'actor' value actor, 'sender' value sender,
                'subject' value subject, 'text' value body returning clob)
                order by at,id returning clob) from notes;";
            var lines = await Query(sql, token, true).ConfigureAwait(false);
            // SQL*Plus can wrap a long CLOB at LINESIZE. Join only its inserted
            // newlines, preserving whitespace inside the JSON strings.
            var clockLine = lines.FindIndex(line => line.StartsWith("T|", StringComparison.Ordinal));
            var json = string.Concat(lines.Skip(clockLine + 1)).Trim();
            if (json.Length == 0 || string.Equals(json, "null", StringComparison.Ordinal))
            {
                return new List<DealNote>();
            }
            try
            {
                var notes = JsonSerializer.Deserialize<List<DealNote>>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                foreach (var note in notes)
                {
                    note.Actor = note.Actor == "L" ? "Lender" : note.Actor == "D" ? "Dealer" : "System";
                }
                return notes;
            }
            catch (JsonException)
            {
                throw new HistoryUnavailableException("QA messages could not be read completely. No partial message list is shown.");
            }
        }

        public async Task<HistoryBatch> Cohort(string lender, string product, int days, CancellationToken token)
        {
            var key = lender + "|" + product + "|" + days;
            HistoryBatch cached;
            if (m_cache.TryGetValue(key, out cached))
            {
                return cached;
            }
            var literal = "'" + lender.Replace("'", "''") + "'";
            // Select recent active profiles first, then fetch their complete version histories.
            // The extra profile detects whether the sample was capped.
            var selection = "select applicationprofileid from (select a.applicationprofileid,max(a.creationdate) last_seen from dtcn.application_dtcan a where a.lenderid=" + literal + " and a.productid=" + product + " and a.new='Y' and a.creationdate >= sysdate-" + days + " group by a.applicationprofileid order by last_seen desc,a.applicationprofileid) where rownum <= " + (CohortLimit + 1);
            var query = EventSelect + "where a.lenderid=" + literal + " and a.productid=" + product + " and a.applicationprofileid in (" + selection + ") order by a.applicationprofileid,a.creationdate,a.applicationid;";
            var batch = Parse(await Query(query, token).ConfigureAwait(false));
            var profiles = batch.Events.GroupBy(e => e.Profile).OrderByDescending(g => g.Max(e => e.At)).ThenBy(g => g.Key).ToList();
            batch.Sampled = profiles.Count > CohortLimit;
            batch.Events = profiles.Take(CohortLimit).SelectMany(g => g).ToList();
            m_cache.Set(key, batch, TimeSpan.FromMinutes(5));
            return batch;
        }

        private static HistoryBatch Parse(List<string> lines)
        {
            var batch = new HistoryBatch();
            batch.ObservedAt = DateTime.ParseExact(lines.Single(l => l.StartsWith("T|", StringComparison.Ordinal)).Substring(2), DateFormat, CultureInfo.InvariantCulture);
            foreach (var line in lines.Where(l => l.StartsWith("E|", StringComparison.Ordinal)))
            {
                var p = line.Split('|');
                batch.Events.Add(new HistoryEvent { Id = long.Parse(p[1], CultureInfo.InvariantCulture), Profile = p[2], Lender = p[3], Product = p[4], Code = p[5], Name = p[6], At = DateTime.ParseExact(p[7], DateFormat, CultureInfo.InvariantCulture), Originator = p[8], Current = p[9] == "Y" });
            }
            return batch;
        }

        private async Task<List<string>> Query(string sql, CancellationToken token, bool preserveWhitespace = false)
        {
            if (!IsConfigured)
            {
                throw new HistoryUnavailableException("QA credentials are not configured. Set Oracle:Password in appsettings.json or DEALFLOW_ORACLE_PASSWORD in the environment.");
            }
            var executable = m_config["Oracle:SqlPlusPath"];
            if (!File.Exists(executable))
            {
                throw new HistoryUnavailableException("SQL*Plus was not found. Set Oracle:SqlPlusPath to the installed client.");
            }
            await m_slots.WaitAsync(token).ConfigureAwait(false);
            try
            {
                using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(token))
                using (var process = new Process())
                {
                    timeout.CancelAfter(TimeSpan.FromSeconds(m_config.GetValue<int>("Oracle:TimeoutSeconds", 40)));
                    process.StartInfo = new ProcessStartInfo(executable, "-S -L /nolog") { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
                    process.StartInfo.Environment["NLS_LANG"] = "AMERICAN_AMERICA.AL32UTF8";
                    process.StartInfo.StandardOutputEncoding = Encoding.UTF8;
                    process.StartInfo.StandardErrorEncoding = Encoding.UTF8;
                    process.StartInfo.Environment.Remove("DEALFLOW_ORACLE_PASSWORD");
                    process.Start();
                    var stdout = process.StandardOutput.ReadToEndAsync();
                    var stderr = process.StandardError.ReadToEndAsync();
                    var password = Password;
                    if (password.IndexOfAny(new[] { '\r', '\n', '"' }) >= 0)
                    {
                        process.Kill(true);
                        throw new HistoryUnavailableException("This SQL*Plus adapter does not support quotes or newlines in passwords.");
                    }
                    await process.StandardInput.WriteLineAsync("set echo off feedback off heading off pagesize 0 linesize 32767 long 10000000 longchunksize 32767 trimspool on verify off define off tab off\nwhenever oserror exit failure\nwhenever sqlerror exit failure").ConfigureAwait(false);
                    await process.StandardInput.WriteLineAsync("connect " + m_config["Oracle:Username"] + "/\"" + password + "\"@" + m_config["Oracle:Alias"]).ConfigureAwait(false);
                    await process.StandardInput.WriteLineAsync("set transaction read only;\nselect 'T|' || to_char(sysdate,'YYYY-MM-DD HH24:MI:SS') from dual;\n" + sql + "\nrollback;\nexit").ConfigureAwait(false);
                    process.StandardInput.Close();
                    try
                    {
                        await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        if (!process.HasExited)
                        {
                            process.Kill(true);
                        }
                        token.ThrowIfCancellationRequested();
                        throw new HistoryUnavailableException("QA query timed out. Try a shorter history period.");
                    }
                    var output = await stdout.ConfigureAwait(false);
                    var errors = await stderr.ConfigureAwait(false);
                    var oracleError = Regex.Match(output + errors, @"(?m)^\s*((?:ORA|SP2)-[0-9]+):");
                    if (process.ExitCode != 0 || oracleError.Success)
                    {
                        var code = oracleError.Groups[1].Value;
                        throw new HistoryUnavailableException("QA query failed" + (code.Length > 0 ? " (" + code + ")" : "") + ". Check the VPN, Oracle alias, and read-only login.");
                    }
                    return output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).Select(l => preserveWhitespace ? l : l.Trim()).ToList();
                }
            }
            finally
            {
                m_slots.Release();
            }
        }
    }
}
