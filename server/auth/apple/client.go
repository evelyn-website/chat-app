package apple

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	AppleTokenEndpoint  = "https://appleid.apple.com/auth/token"
	AppleRevokeEndpoint = "https://appleid.apple.com/auth/revoke"

	grantTypeAuthCode    = "authorization_code"
	tokenTypeHintRefresh = "refresh_token"
)

// Client calls Apple's server-to-server endpoints. Constructed once per
// process; the underlying http.Client is reused.
type Client struct {
	Cfg        ClientSecretConfig
	HTTP       *http.Client
	TokenURL   string // overridable for tests
	RevokeURL  string // overridable for tests
	Now        func() time.Time
}

// NewClient constructs a Client with sane defaults. now is optional — if nil,
// time.Now is used.
func NewClient(cfg ClientSecretConfig) *Client {
	return &Client{
		Cfg:       cfg,
		HTTP:      &http.Client{Timeout: 10 * time.Second},
		TokenURL:  AppleTokenEndpoint,
		RevokeURL: AppleRevokeEndpoint,
		Now:       time.Now,
	}
}

// TokenResponse is the subset of Apple's /auth/token response we care about.
// Apple also returns id_token and access_token but we ignore those —
// verification already happened on the SIWA id_token.
type TokenResponse struct {
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

// appleError is the error shape Apple returns on 4xx.
type appleError struct {
	Code        string `json:"error"`
	Description string `json:"error_description"`
}

// ErrAuthorizationCodeInvalid indicates Apple rejected the one-time code.
// Most commonly this means the code already ran through /auth/token (single
// use) or expired (~5 min TTL). Callers should surface a distinct client
// signal so the user can re-sign with a fresh code.
var ErrAuthorizationCodeInvalid = errors.New("apple: authorization_code invalid or consumed")

// doPost POSTs a URL-encoded form to endpoint and returns the response body and
// status code. Transport errors (not HTTP errors) are returned as err.
func (c *Client) doPost(ctx context.Context, endpoint string, form url.Values) (body []byte, status int, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, _ = io.ReadAll(resp.Body)
	return body, resp.StatusCode, nil
}

// ExchangeAuthorizationCode runs the authorization_code grant. On success the
// returned TokenResponse.RefreshToken is Apple's long-lived refresh token for
// this identity; store it encrypted.
func (c *Client) ExchangeAuthorizationCode(ctx context.Context, code string) (*TokenResponse, error) {
	secret, err := BuildClientSecret(c.Cfg, c.Now())
	if err != nil {
		return nil, err
	}
	form := url.Values{
		"client_id":     {c.Cfg.ServicesID},
		"client_secret": {secret},
		"grant_type":    {grantTypeAuthCode},
		"code":          {code},
	}
	body, status, err := c.doPost(ctx, c.TokenURL, form)
	if err != nil {
		return nil, fmt.Errorf("apple: /auth/token: %w", err)
	}
	if status >= 400 {
		var ae appleError
		_ = json.Unmarshal(body, &ae)
		if ae.Code == "invalid_grant" {
			return nil, ErrAuthorizationCodeInvalid
		}
		return nil, fmt.Errorf("apple: /auth/token %d: %s (%s)", status, ae.Code, ae.Description)
	}
	var tr TokenResponse
	if err := json.Unmarshal(body, &tr); err != nil {
		return nil, fmt.Errorf("apple: parse /auth/token body: %w", err)
	}
	if tr.RefreshToken == "" {
		return nil, errors.New("apple: /auth/token returned no refresh_token")
	}
	return &tr, nil
}

// RevokeRefreshToken tells Apple to invalidate a refresh_token. Used on account
// deletion. Per Apple's spec, a 200 with empty body is the success signal.
func (c *Client) RevokeRefreshToken(ctx context.Context, refreshToken string) error {
	secret, err := BuildClientSecret(c.Cfg, c.Now())
	if err != nil {
		return err
	}
	form := url.Values{
		"client_id":       {c.Cfg.ServicesID},
		"client_secret":   {secret},
		"token":           {refreshToken},
		"token_type_hint": {tokenTypeHintRefresh},
	}
	body, status, err := c.doPost(ctx, c.RevokeURL, form)
	if err != nil {
		return fmt.Errorf("apple: /auth/revoke: %w", err)
	}
	if status >= 400 {
		var ae appleError
		_ = json.Unmarshal(body, &ae)
		return fmt.Errorf("apple: /auth/revoke %d: %s (%s)", status, ae.Code, ae.Description)
	}
	return nil
}
