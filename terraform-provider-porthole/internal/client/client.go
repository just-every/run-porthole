package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxResponseBytes = 2 * 1024 * 1024

var knownErrors = map[string]bool{
	"unauthenticated": true, "native_session_required": true, "invalid_origin": true,
	"authority_changed": true, "definition_change_forbidden": true, "scope_forbidden": true,
	"configuration_not_found": true, "dashboard_not_found": true, "revision_conflict": true,
	"revision_or_authority_changed": true, "revision_required": true, "invalid_revision": true,
	"idempotency_conflict": true, "idempotency_key_required": true, "invalid_definition": true,
	"configuration_quarantined": true, "rate_limited": true, "input_too_large": true,
	"audit_unavailable": true, "configuration_unavailable": true, "dashboards_unavailable": true,
	"invalid_dashboard": true, "definition_in_use": true, "invalid_dashboard_scope": true,
}

// Client keeps native authority in process memory, outside Terraform schemas.
type Client struct {
	origin  string
	session string
	http    *http.Client
}

func (c *Client) String() string   { return "Porthole client" }
func (c *Client) GoString() string { return "Porthole client" }

func ValidateOrigin(value string) (string, error) {
	u, err := url.Parse(value)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawPath != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("origin must be an installation origin without credentials, a path, a query or a fragment")
	}
	loopback := strings.EqualFold(u.Hostname(), "localhost")
	if ip := net.ParseIP(u.Hostname()); ip != nil {
		loopback = ip.IsLoopback()
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && loopback) {
		return "", errors.New("origin requires HTTPS; HTTP is allowed only on loopback")
	}
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return "", errors.New("origin has an invalid port")
		}
	}
	return u.Scheme + "://" + u.Host, nil
}

func New(origin, session string) (*Client, error) {
	base, err := ValidateOrigin(origin)
	if err != nil {
		return nil, err
	}
	if session == "" || strings.ContainsAny(session, "\r\n") {
		return nil, errors.New("set PORTHOLE_SESSION to the native installation cookie header")
	}
	return &Client{origin: base, session: session, http: &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}}, nil
}

type APIError struct {
	Status     int
	Code       string
	RetryAfter int
}

func (e *APIError) Error() string {
	message := fmt.Sprintf("Porthole refused the request (%d %s)", e.Status, e.Code)
	if e.Status == 409 || e.Status == 412 {
		message += "; refresh and review a new plan before applying"
	}
	if e.Status == 429 && e.RetryAfter > 0 {
		message += fmt.Sprintf("; retry after %d seconds", e.RetryAfter)
	}
	return message
}

func (c *Client) request(ctx context.Context, method, path string, input, output any, revision int, key, archiveRedirect string) error {
	var body io.Reader
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return errors.New("definition cannot be encoded as JSON")
		}
		if len(encoded) > 8192 {
			return errors.New("definition exceeds the API request limit of 8192 bytes")
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.origin+path, body)
	if err != nil {
		return errors.New("Porthole request could not be constructed")
	}
	req.Header.Set("Cookie", c.session)
	req.Header.Set("Origin", c.origin)
	req.Header.Set("Accept", "application/json")
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if revision > 0 {
		req.Header.Set("If-Match", fmt.Sprintf(`"%d"`, revision))
	}
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return errors.New("Porthole endpoint unavailable; inspect the native object before repeating an uncertain mutation")
	}
	defer res.Body.Close()
	// The native dashboard form returns a fixed local redirect after commit.
	// A redirect is never followed with the session cookie.
	if archiveRedirect != "" && res.StatusCode == http.StatusSeeOther && res.Header.Get("Location") == archiveRedirect {
		return nil
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes+1))
	if err != nil || len(raw) > maxResponseBytes {
		return errors.New("Porthole returned an unreadable or oversized response")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		value := struct {
			Error string `json:"error"`
		}{}
		_ = json.Unmarshal(raw, &value)
		code := "request_refused"
		if knownErrors[value.Error] {
			code = value.Error
		}
		retry, _ := strconv.Atoi(res.Header.Get("Retry-After"))
		return &APIError{Status: res.StatusCode, Code: code, RetryAfter: retry}
	}
	if output != nil && json.Unmarshal(raw, output) != nil {
		return errors.New("Porthole returned an invalid JSON response")
	}
	return nil
}
