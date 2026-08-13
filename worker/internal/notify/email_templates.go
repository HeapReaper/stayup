package notify

import "html/template"

// The two templates below are Go html/template equivalents of
// src/emails/incident-update-email.tsx and src/emails/integration-alert-email.tsx —
// same purple card layout via inline CSS instead of Tailwind/React Email
// (no JS build step available here), not byte-for-byte identical markup.

const emailBaseCSS = `
	body{margin:0;padding:40px 0;background:#faf5ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
	.card{max-width:480px;margin:0 auto;padding:32px;background:#ffffff;border:1px solid #f3e8ff;border-radius:16px;box-shadow:0 1px 2px rgba(0,0,0,.05);}
	.logo{display:inline-block;width:40px;height:40px;background:#7c3aed;border-radius:12px;color:#fff;font-weight:700;font-size:20px;line-height:40px;text-align:center;}
	.brand{text-align:center;margin-bottom:24px;}
	.brand-text{font-size:18px;font-weight:700;color:#3b0764;margin:8px 0 0;}
	.brand-text span{color:#7c3aed;}
	.status{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:center;margin-bottom:8px;}
	h1{color:#3b0764;font-size:24px;font-weight:800;text-align:center;margin:0 0 4px;}
	.subject{color:#3b0764;font-size:20px;font-weight:800;text-align:center;margin:0 0 16px;}
	.affected{color:#c4b5fd;font-size:12px;text-align:center;margin:0 0 16px;}
	.message{color:#5b21b6;font-size:16px;line-height:1.6;margin:0 0 24px;white-space:pre-line;}
	.button-wrap{text-align:center;margin-bottom:28px;}
	.button{display:inline-block;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:12px;font-weight:600;font-size:14px;text-decoration:none;}
	hr{border:none;border-top:1px solid #f3e8ff;margin:24px 0;}
	.footer{color:#c4b5fd;font-size:12px;text-align:center;margin:0;}
`

var incidentUpdateTemplate = template.Must(template.New("incident-update").Parse(`<!doctype html>
<html><head><meta charset="utf-8"><style>` + emailBaseCSS + `</style></head>
<body><div class="card">
	<div class="brand"><div class="logo">S</div><p class="brand-text">Stay<span>Up</span></p></div>
	<p class="status" style="color:{{.StatusColor}}">{{.Status}}</p>
	<h1>{{.IncidentTitle}}</h1>
	{{if .MonitorName}}<p class="affected">Affected: {{.MonitorName}}</p>{{end}}
	<p class="message">{{.Message}}</p>
	<div class="button-wrap"><a class="button" href="{{.IncidentURL}}">View Incident &rarr;</a></div>
	<hr>
	<p class="footer">You're receiving this because you subscribed to updates on this incident.</p>
</div></body></html>`))

// IncidentUpdateData mirrors IncidentUpdateEmailProps.
type IncidentUpdateData struct {
	IncidentTitle string
	Status        string
	StatusColor   string
	Message       string
	MonitorName   string
	IncidentURL   string
}

var statusColors = map[string]string{
	"Investigating": "#e11d48",
	"Identified":    "#d97706",
	"Monitoring":    "#2563eb",
	"Resolved":      "#059669",
}

// StatusColor mirrors STATUS_COLORS in incident-update-email.tsx (falls back
// to the brand purple for unrecognized statuses).
func StatusColor(status string) string {
	if c, ok := statusColors[status]; ok {
		return c
	}
	return "#7c3aed"
}

// IncidentUpdateTemplate is the rendered-HTML template for SendEmail.
func IncidentUpdateTemplate() *template.Template { return incidentUpdateTemplate }

var integrationAlertTemplate = template.Must(template.New("integration-alert").Parse(`<!doctype html>
<html><head><meta charset="utf-8"><style>` + emailBaseCSS + `</style></head>
<body><div class="card">
	<div class="brand"><div class="logo">S</div><p class="brand-text">Stay<span>Up</span></p></div>
	<p class="subject">{{.Subject}}</p>
	<p class="message">{{.Message}}</p>
	<hr>
	<p class="footer">Sent by an Integration configured on your monitoring dashboard.</p>
</div></body></html>`))

// IntegrationAlertData mirrors IntegrationAlertEmailProps.
type IntegrationAlertData struct {
	Subject string
	Message string
}

// IntegrationAlertTemplate is the rendered-HTML template for SendEmail.
func IntegrationAlertTemplate() *template.Template { return integrationAlertTemplate }
