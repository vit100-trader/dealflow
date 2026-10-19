using System;
using System.Collections.Generic;
using System.Linq;

namespace DealFlow
{
    public class FlowVisit
    {
        public string Code { get; set; }
        public string Name { get; set; }
        public DateTime At { get; set; }
        public DateTime? Until { get; set; }
        public double Hours { get; set; }
        public int Snapshots { get; set; }
        public long ApplicationId { get; set; }
        public string Actor { get; set; }
    }

    public class FlowEdge
    {
        public string From { get; set; }
        public string To { get; set; }
        public int Count { get; set; }
        public int Deals { get; set; }
        public double MeanHours { get; set; }
        public double MedianHours { get; set; }
        public double P90Hours { get; set; }
        public double Probability { get; set; }
        public bool OnDeal { get; set; }
        public bool Happy { get; set; }
        public double[] DealHours { get; set; }
    }

    public class FlowNode
    {
        public string Code { get; set; }
        public string Name { get; set; }
        public bool Current { get; set; }
        public bool Visited { get; set; }
        public bool Terminal { get; set; }
        public int DealVisits { get; set; }
        public int HistoricalVisits { get; set; }
        public int CompletedVisits { get; set; }
        public int OpenVisits { get; set; }
        public double? MeanHours { get; set; }
        public double? MedianHours { get; set; }
        public double? P90Hours { get; set; }
    }

    public class DealFlowResult
    {
        public List<FlowVisit> Timeline { get; set; }
        public List<FlowNode> Nodes { get; set; }
        public List<FlowEdge> Edges { get; set; }
        public string CurrentCode { get; set; }
        public bool Closed { get; set; }
        public int Snapshots { get; set; }
        public int CohortDeals { get; set; }
        public int SuccessfulDeals { get; set; }
        public double ElapsedHours { get; set; }
        public double CurrentHours { get; set; }
        public double? MedianSuccessHours { get; set; }
        public string[] HappyPath { get; set; }
        public int HappyPathDeals { get; set; }
        public int ApprovalOnlyDeals { get; set; }
        public string[] ApprovalPath { get; set; }
        public int ApprovalPathDeals { get; set; }
        public double? MedianApprovalHours { get; set; }
        public string[] Warnings { get; set; }
    }

    public static class FlowAnalysis
    {
        private static readonly HashSet<string> Terminal = new HashSet<string>(new[] { "BK", "FN", "DE", "WD", "EA", "EX" }, StringComparer.Ordinal);
        private static readonly HashSet<string> Successful = new HashSet<string>(new[] { "BK", "FN" }, StringComparer.Ordinal);

        public static List<FlowVisit> Collapse(IEnumerable<HistoryEvent> events, DateTime observedAt)
        {
            var visits = new List<FlowVisit>();
            foreach (var item in events.OrderBy(e => e.At).ThenBy(e => e.Id))
            {
                if (visits.Count > 0 && visits[visits.Count - 1].Code == item.Code)
                {
                    visits[visits.Count - 1].Snapshots++;
                    continue;
                }
                visits.Add(new FlowVisit { Code = item.Code, Name = Label(item), At = item.At, Snapshots = 1, ApplicationId = item.Id, Actor = item.Originator == "D" ? "Dealer" : item.Originator == "L" ? "Lender" : "System" });
            }
            for (var i = 0; i < visits.Count; i++)
            {
                var visit = visits[i];
                visit.Until = i + 1 < visits.Count ? (DateTime?)visits[i + 1].At : null;
                visit.Hours = Math.Max(0, ((visit.Until ?? (Terminal.Contains(visit.Code) ? visit.At : observedAt)) - visit.At).TotalHours);
            }
            return visits;
        }

        public static DealFlowResult Build(List<HistoryEvent> selected, List<HistoryEvent> history, DateTime observedAt)
        {
            var timeline = Collapse(selected, observedAt);
            var current = timeline.Last();
            var cohort = history.Where(e => e.Profile != selected[0].Profile)
                .GroupBy(e => e.Profile + "|" + e.Lender + "|" + e.Product)
                .Select(g => Collapse(g, observedAt)).Where(v => v.Count > 0).ToList();
            var transitions = cohort.SelectMany((visits, deal) => visits.Take(visits.Count - 1).Select((v, i) => new { From = v.Code, To = visits[i + 1].Code, v.Hours, Deal = deal })).ToList();
            var successful = cohort.Where(v => Successful.Contains(v.Last().Code)).ToList();
            var happy = successful.GroupBy(v => string.Join(">", v.Select(e => e.Code)))
                .OrderByDescending(g => g.Count()).ThenBy(g => g.First().Count).ThenBy(g => g.Key, StringComparer.Ordinal).FirstOrDefault();
            var happyPath = happy == null ? new string[0] : happy.First().Select(v => v.Code).ToArray();
            // Approval remains a milestone, separate from completed funding.
            // Never substitute an approval-only path when no funded path exists.
            var approvalOnly = cohort.Where(v => v.Last().Code == "AP").ToList();
            var approvalRoute = approvalOnly.GroupBy(v => string.Join(">", v.Select(e => e.Code)))
                .OrderByDescending(g => g.Count()).ThenBy(g => g.First().Count).ThenBy(g => g.Key, StringComparer.Ordinal).FirstOrDefault();
            var approvalPath = approvalRoute == null ? new string[0] : approvalRoute.First().Select(v => v.Code).ToArray();
            var allEvents = selected.Concat(history).ToList();
            var codes = allEvents.Select(e => e.Code).Distinct().ToList();
            var edges = new List<FlowEdge>();
            var pairs = transitions.Select(t => t.From + "|" + t.To)
                .Concat(timeline.Take(timeline.Count - 1).Select((v, i) => v.Code + "|" + timeline[i + 1].Code)).Distinct();
            foreach (var pair in pairs)
            {
                var p = pair.Split('|');
                var sample = transitions.Where(t => t.From == p[0] && t.To == p[1]).ToList();
                var durations = sample.Select(t => t.Hours).ToList();
                var total = transitions.Count(t => t.From == p[0]);
                var actual = timeline.Take(timeline.Count - 1).Select((v, i) => new { Visit = v, Next = timeline[i + 1] }).Where(t => t.Visit.Code == p[0] && t.Next.Code == p[1]).Select(t => t.Visit.Hours).ToArray();
                edges.Add(new FlowEdge { From = p[0], To = p[1], Count = sample.Count, Deals = sample.Select(t => t.Deal).Distinct().Count(), MeanHours = durations.Count == 0 ? 0 : durations.Average(), MedianHours = Percentile(durations, 0.5) ?? 0, P90Hours = Percentile(durations, 0.9) ?? 0, Probability = total == 0 ? 0 : (double)sample.Count / total, OnDeal = actual.Length > 0, DealHours = actual, Happy = happyPath.Take(Math.Max(0, happyPath.Length - 1)).Where((v, i) => v == p[0] && happyPath[i + 1] == p[1]).Any() });
            }
            var nodes = codes.Select(code =>
            {
                var visits = cohort.SelectMany(v => v).Where(v => v.Code == code).ToList();
                // Only observed exits enter duration statistics. Open waits are censored.
                var completed = visits.Where(v => v.Until.HasValue).Select(v => v.Hours).ToList();
                return new FlowNode { Code = code, Name = Label(allEvents.First(e => e.Code == code)), Current = code == current.Code, Visited = timeline.Any(v => v.Code == code), Terminal = Terminal.Contains(code), DealVisits = timeline.Count(v => v.Code == code), HistoricalVisits = visits.Count, CompletedVisits = completed.Count, OpenVisits = visits.Count(v => !v.Until.HasValue && !Terminal.Contains(code)), MeanHours = completed.Count == 0 ? (double?)null : completed.Average(), MedianHours = Percentile(completed, .5), P90Hours = Percentile(completed, .9) };
            }).ToList();
            var closed = Terminal.Contains(current.Code);
            var warnings = new List<string>();
            if (cohort.Count < 20)
            {
                warnings.Add("Small comparison sample: treat timing and next-state shares as exploratory.");
            }
            var flagged = selected.Where(e => e.Current).ToList();
            if (flagged.Count != 1 || flagged[0].Code != current.Code)
            {
                warnings.Add("The latest history status does not have a unique matching NEW=Y snapshot. Verify the source application before relying on it.");
            }
            if (selected.Any(e => e.At > observedAt))
            {
                warnings.Add("Some history timestamps are later than the QA database clock.");
            }
            return new DealFlowResult { Timeline = timeline, Nodes = nodes, Edges = edges, CurrentCode = current.Code, Closed = closed, Snapshots = selected.Count, CohortDeals = cohort.Count, SuccessfulDeals = successful.Count, ElapsedHours = Math.Max(0, ((closed ? current.At : observedAt) - timeline[0].At).TotalHours), CurrentHours = current.Hours, MedianSuccessHours = Percentile(successful.Select(v => (v.Last().At - v.First().At).TotalHours).ToList(), .5), HappyPath = happyPath, HappyPathDeals = happy == null ? 0 : happy.Count(), ApprovalOnlyDeals = approvalOnly.Count, ApprovalPath = approvalPath, ApprovalPathDeals = approvalRoute == null ? 0 : approvalRoute.Count(), MedianApprovalHours = Percentile(approvalOnly.Select(v => (v.Last().At - v.First().At).TotalHours).ToList(), .5), Warnings = warnings.ToArray() };
        }

        private static string Label(HistoryEvent item)
        {
            if (item.Name.StartsWith(item.Code + " - ", StringComparison.Ordinal))
            {
                return item.Name.Substring(item.Code.Length + 3);
            }
            return item.Name == "EN" ? item.Code : item.Name;
        }

        private static double? Percentile(List<double> values, double fraction)
        {
            if (values.Count == 0)
            {
                return null;
            }
            var sorted = values.OrderBy(v => v).ToList();
            var index = (sorted.Count - 1) * fraction;
            var low = (int)Math.Floor(index);
            var high = (int)Math.Ceiling(index);
            return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
        }
    }
}
