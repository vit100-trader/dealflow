using System;

namespace DealFlow
{
    public class DealNote
    {
        public string Id { get; set; }
        public string Source { get; set; }
        public DateTime? At { get; set; }
        public string Actor { get; set; }
        public string Sender { get; set; }
        public string Subject { get; set; }
        public string Text { get; set; }
        public string StateCode { get; set; }
        public DateTime? VisitAt { get; set; }
    }
}
