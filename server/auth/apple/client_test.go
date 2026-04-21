package apple

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// newTestClient stands up an httptest server that impersonates Apple's
// /auth/token and /auth/revoke and returns a Client pointed at it.
func newTestClient(t *testing.T, handler http.Handler) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	key, _ := genP256(t)
	c := NewClient(ClientSecretConfig{
		TeamID:     "T",
		KeyID:      "K",
		ServicesID: "com.example.signin",
		PrivateKey: key,
	})
	c.TokenURL = srv.URL + "/auth/token"
	c.RevokeURL = srv.URL + "/auth/revoke"
	c.Now = func() time.Time { return time.Unix(1_700_000_000, 0) }
	return c
}

func TestExchangeAuthorizationCode_Success(t *testing.T) {
	var captured url.Values
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		captured, _ = url.ParseQuery(string(body))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"refresh_token":"r.apple.rt","expires_in":3600,"token_type":"Bearer"}`))
	}))
	tr, err := c.ExchangeAuthorizationCode(context.Background(), "c.apple.code")
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	if tr.RefreshToken != "r.apple.rt" {
		t.Errorf("refresh_token: got %q", tr.RefreshToken)
	}
	if captured.Get("grant_type") != "authorization_code" {
		t.Errorf("grant_type: got %q", captured.Get("grant_type"))
	}
	if captured.Get("code") != "c.apple.code" {
		t.Errorf("code: got %q", captured.Get("code"))
	}
	if captured.Get("client_id") != "com.example.signin" {
		t.Errorf("client_id: got %q", captured.Get("client_id"))
	}
	if cs := captured.Get("client_secret"); !strings.HasPrefix(cs, "eyJ") {
		t.Errorf("client_secret doesn't look like a JWT: %q", cs)
	}
}

func TestExchangeAuthorizationCode_InvalidGrant(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"code consumed"}`))
	}))
	_, err := c.ExchangeAuthorizationCode(context.Background(), "bad")
	if !errors.Is(err, ErrAuthorizationCodeInvalid) {
		t.Fatalf("got %v want ErrAuthorizationCodeInvalid", err)
	}
}

func TestExchangeAuthorizationCode_OtherError(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"server_error"}`))
	}))
	_, err := c.ExchangeAuthorizationCode(context.Background(), "x")
	if err == nil || errors.Is(err, ErrAuthorizationCodeInvalid) {
		t.Fatalf("expected generic error, got %v", err)
	}
}

func TestExchangeAuthorizationCode_EmptyRefreshToken(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"refresh_token":"","expires_in":0}`))
	}))
	if _, err := c.ExchangeAuthorizationCode(context.Background(), "x"); err == nil {
		t.Fatal("expected error on empty refresh_token")
	}
}

func TestRevokeRefreshToken_Success(t *testing.T) {
	var captured url.Values
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		captured, _ = url.ParseQuery(string(body))
		w.WriteHeader(http.StatusOK)
	}))
	if err := c.RevokeRefreshToken(context.Background(), "r.apple.rt"); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if captured.Get("token") != "r.apple.rt" {
		t.Errorf("token: got %q", captured.Get("token"))
	}
	if captured.Get("token_type_hint") != "refresh_token" {
		t.Errorf("hint: got %q", captured.Get("token_type_hint"))
	}
}

func TestRevokeRefreshToken_Error(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_client"}`))
	}))
	if err := c.RevokeRefreshToken(context.Background(), "r"); err == nil {
		t.Fatal("expected error")
	}
}
