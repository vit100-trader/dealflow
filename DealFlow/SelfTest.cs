using System;
using System.Collections.Generic;
using System.Linq;

namespace DealFlow
{
    public static class SelfTest
    {
        public static void Run()
        {
            var start = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Unspecified);
            var events = new List<HistoryEvent>();
            Add(events, "1", "SU", start, 1);
            Add(events, "1", "SU", start.AddHours(1), 2);
            Add(events, "1", "AD", start.AddHours(2), 3);
            Add(events, "1", "DI", start.AddHours(5), 4);
            Add(events, "1", "SU", start.AddHours(8), 5);
            Add(events, "1", "AD", start.AddHours(9), 6);
            events.Last().Current = true;
            var cohort = new List<HistoryEvent>();
            Add(cohort, "2", "SU", start, 10);
            Add(cohort, "2", "AD", start.AddHours(2), 11);
            Add(cohort, "2", "AP", start.AddHours(6), 12);
            Add(cohort, "3", "SU", start, 20);
            Add(cohort, "3", "AD", start.AddHours(4), 21);
            Add(cohort, "3", "AD", start.AddHours(30), 22);
            cohort.AddRange(events); // selected deal must be excluded from its own baseline
            var flow = FlowAnalysis.Build(events, cohort, start.AddHours(40));
            Check(flow.Timeline.Count == 5, "Collapse saves, retain resubmission loops");
            Check(flow.Timeline[0].Hours == 2 && flow.Timeline[0].Snapshots == 2, "Repeated save does not reset dwell");
            Check(flow.CurrentCode == "AD" && flow.CurrentHours == 31, "Use first entry into current status");
            Check(flow.CohortDeals == 2, "Exclude selected deal from baseline");
            var ad = flow.Nodes.Single(n => n.Code == "AD");
            Check(ad.MeanHours == 4 && ad.CompletedVisits == 1 && ad.OpenVisits == 1, "Exclude open waits from completed dwell statistics");
            var submission = flow.Edges.Single(e => e.From == "SU" && e.To == "AD");
            Check(submission.Count == 2 && submission.Deals == 2 && submission.MeanHours == 3 && submission.P90Hours == 3.8, "Aggregate transitions and interpolate percentiles");
            Check(submission.DealHours.SequenceEqual(new[] { 2.0, 1.0 }), "Retain repeated transition durations");
            Check(flow.HappyPath.Length == 0 && flow.MedianSuccessHours == null && flow.ApprovalPath.SequenceEqual(new[] { "SU", "AD", "AP" }) && flow.ApprovalPathDeals == 1 && flow.MedianApprovalHours == 6, "Keep approval-only histories separate from completed funding");
            var declined = new List<HistoryEvent>();
            Add(declined, "4", "SU", start, 30);
            Add(declined, "4", "DE", start.AddHours(2), 31);
            declined.Last().Current = true;
            var closed = FlowAnalysis.Build(declined, new List<HistoryEvent>(), start.AddDays(20));
            Check(closed.Closed && closed.ElapsedHours == 2 && closed.CurrentHours == 0, "Terminal outcome stops the clock");
            Check(closed.HappyPath.Length == 0 && closed.MedianSuccessHours == null, "No fabricated success route for empty cohorts");
            var tied = new List<HistoryEvent>();
            Add(tied, "5", "AD", start, 41);
            Add(tied, "5", "SU", start, 40);
            Check(FlowAnalysis.Collapse(tied, start)[0].Code == "SU", "Application ID breaks timestamp ties");
            Console.WriteLine("Passed 11 flow-analysis checks.");
        }

        private static void Add(List<HistoryEvent> events, string profile, string code, DateTime at, long id)
        {
            events.Add(new HistoryEvent { Id = id, Profile = profile, Lender = "TEST", Product = "1", Code = code, Name = code, At = at, Originator = "D" });
        }

        private static void Check(bool condition, string description)
        {
            if (!condition)
            {
                throw new InvalidOperationException("FAILED: " + description);
            }
        }
    }
}
