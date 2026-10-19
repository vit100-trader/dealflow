using System;
using System.Linq;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace DealFlow
{
    public class Program
    {
        public static async Task Main(string[] args)
        {
            if (args.Contains("--self-test"))
            {
                SelfTest.Run();
                return;
            }

            var builder = WebApplication.CreateBuilder(args);
            builder.Services.AddMemoryCache();
            builder.Services.AddSingleton<OracleHistory>();
            var app = builder.Build();
            app.Use(async (context, next) =>
            {
                var remote = context.Connection.RemoteIpAddress;
                if (remote != null && !IPAddress.IsLoopback(remote))
                {
                    context.Response.StatusCode = 403;
                    return;
                }
                context.Response.Headers["Cache-Control"] = "no-store";
                context.Response.Headers["X-Content-Type-Options"] = "nosniff";
                context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
                try
                {
                    await next(context).ConfigureAwait(false);
                }
                catch (HistoryUnavailableException exception)
                {
                    context.Response.StatusCode = 503;
                    await context.Response.WriteAsJsonAsync(new { error = exception.Message }).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
                {
                    context.Response.StatusCode = 499;
                }
            });
            app.UseDefaultFiles();
            app.UseStaticFiles();
            app.MapGet("/api/health", async context =>
            {
                var history = context.RequestServices.GetRequiredService<OracleHistory>();
                await Results.Ok(new { source = "DTCAN_QA", configured = history.IsConfigured, scope = "Auto applications", readOnly = true }).ExecuteAsync(context).ConfigureAwait(false);
            });
            app.MapGet("/api/recent", async context =>
            {
                var history = context.RequestServices.GetRequiredService<OracleHistory>();
                await Results.Ok(await history.Recent(context.RequestAborted).ConfigureAwait(false)).ExecuteAsync(context).ConfigureAwait(false);
            });
            app.MapGet("/api/statuses", async context =>
            {
                var history = context.RequestServices.GetRequiredService<OracleHistory>();
                await Results.Ok(await history.Catalog(context.RequestAborted).ConfigureAwait(false)).ExecuteAsync(context).ConfigureAwait(false);
            });
            app.MapGet("/api/deals/{id}", async context =>
            {
                await (await GetDeal(context).ConfigureAwait(false)).ExecuteAsync(context).ConfigureAwait(false);
            });
            await app.RunAsync().ConfigureAwait(false);
        }

        private static async Task<IResult> GetDeal(HttpContext context)
        {
            var id = context.Request.RouteValues["id"].ToString();
            var request = context.Request;
            var history = context.RequestServices.GetRequiredService<OracleHistory>();
            var token = context.RequestAborted;
            if (!Regex.IsMatch(id, "\\A[0-9]{1,18}\\z"))
            {
                return Results.BadRequest(new { error = "Enter a numeric deal ID or application ID." });
            }
            var days = 30;
            if (request.Query.ContainsKey("days") && (!int.TryParse(request.Query["days"], out days) || days < 1 || days > 365))
            {
                return Results.BadRequest(new { error = "History period must be between 1 and 365 days." });
            }
            var lookup = await history.Find(id, token).ConfigureAwait(false);
            if (lookup.Events.Count == 0)
            {
                return Results.NotFound(new { error = "No auto application history found for this ID in QA." });
            }
            var groups = lookup.Events.GroupBy(e => e.Lender + "|" + e.Product).OrderByDescending(g => g.Max(e => e.At)).ToList();
            var selected = groups.FirstOrDefault(g => g.Key == request.Query["stream"].ToString()) ?? groups[0];
            var first = selected.First();
            var cohort = await history.Cohort(first.Lender, first.Product, days, token).ConfigureAwait(false);
            var flow = FlowAnalysis.Build(selected.ToList(), cohort.Events, lookup.ObservedAt);
            var notes = await history.Notes(first.Profile, first.Lender, first.Product, token).ConfigureAwait(false);
            foreach (var note in notes)
            {
                // Notes are scoped to this lender/product, then placed in the
                // half-open visit interval [entry, next entry) by database time.
                var visit = note.At.HasValue ? flow.Timeline.LastOrDefault(v => v.At <= note.At.Value && (!v.Until.HasValue || note.At.Value < v.Until.Value)) : null;
                if (visit != null)
                {
                    note.StateCode = visit.Code;
                    note.VisitAt = visit.At;
                }
            }
            return Results.Ok(new
            {
                dealId = first.Profile, lender = first.Lender, product = first.Product,
                stream = selected.Key,
                streams = groups.Select(g => new { key = g.Key, lender = g.First().Lender, product = g.First().Product }),
                source = "DTCAN_QA", asset = "Auto", observedAt = lookup.ObservedAt,
                cohortObservedAt = cohort.ObservedAt, days,
                sampleLimit = history.CohortLimit, sampled = cohort.Sampled,
                flow, notes
            });
        }
    }
}
