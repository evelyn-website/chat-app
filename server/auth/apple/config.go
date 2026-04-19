package apple

import (
	"fmt"
	"os"
)

// Env var names for the Apple server-to-server credentials.
const (
	EnvTeamID     = "APPLE_TEAM_ID"
	EnvKeyID      = "APPLE_KEY_ID"
	EnvPrivateKey = "APPLE_PRIVATE_KEY" // contents of the .p8 (PEM text, multiline)
	EnvServicesID = "APPLE_SERVICES_ID" // audience for our id_token; also client_id
)

// LoadConfigFromEnv reads all four Apple env vars and returns a validated
// ClientSecretConfig ready to pass to NewClient. Fails fast with a single
// error listing any missing fields so misconfigured deploys are obvious at
// startup rather than at first sign-in.
func LoadConfigFromEnv() (ClientSecretConfig, error) {
	team := os.Getenv(EnvTeamID)
	key := os.Getenv(EnvKeyID)
	svc := os.Getenv(EnvServicesID)
	pk := os.Getenv(EnvPrivateKey)
	if team == "" || key == "" || svc == "" || pk == "" {
		return ClientSecretConfig{}, fmt.Errorf(
			"apple: missing env (team=%v key=%v services=%v privateKey=%v)",
			team != "", key != "", svc != "", pk != "",
		)
	}
	parsed, err := ParsePrivateKey([]byte(pk))
	if err != nil {
		return ClientSecretConfig{}, fmt.Errorf("apple: %s: %w", EnvPrivateKey, err)
	}
	return ClientSecretConfig{
		TeamID:     team,
		KeyID:      key,
		ServicesID: svc,
		PrivateKey: parsed,
	}, nil
}
