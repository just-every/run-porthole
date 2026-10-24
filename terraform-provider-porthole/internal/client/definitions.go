package client

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
)

var objectID = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

func ValidID(id string) bool { return objectID.MatchString(id) }

type Definition struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Scope    json.RawMessage `json:"scope"`
	Body     json.RawMessage `json:"body"`
	Revision int             `json:"revision"`
	State    string          `json:"state"`
}

type Input struct {
	Name     string          `json:"name"`
	Scope    json.RawMessage `json:"scope"`
	Body     json.RawMessage `json:"body"`
	ID       string          `json:"id,omitempty"`
	Revision int             `json:"revision,omitempty"`
}

func root(kind string) (string, error) {
	switch kind {
	case "monitor":
		return "/api/porthole/v1/configuration/monitors", nil
	case "dashboard":
		return "/api/porthole/v1/dashboards", nil
	}
	return "", errors.New("unsupported native resource")
}

func (c *Client) Read(ctx context.Context, kind, id string) (*Definition, error) {
	path, err := root(kind)
	if err != nil || !ValidID(id) {
		return nil, errors.New("resource ID must be a native object UUID")
	}
	var value Definition
	if err := c.request(ctx, http.MethodGet, path+"/"+id, nil, &value, 0, "", ""); err != nil {
		return nil, err
	}
	if value.ID != id || value.Revision < 1 || value.Name == "" || len(value.Scope) == 0 || len(value.Body) == 0 {
		return nil, errors.New("Porthole returned an invalid native definition")
	}
	return &value, nil
}

func operationKey() (string, error) {
	var bytes [24]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", errors.New("could not allocate an operation key")
	}
	return hex.EncodeToString(bytes[:]), nil
}

func (c *Client) Write(ctx context.Context, kind, id string, expected int, input Input) (*Definition, error) {
	path, err := root(kind)
	if err != nil {
		return nil, err
	}
	method := http.MethodPost
	if id != "" {
		if !ValidID(id) || expected < 1 {
			return nil, errors.New("update requires the saved native UUID and revision")
		}
		if kind == "monitor" {
			method = http.MethodPut
			path += "/" + id
		} else {
			input.ID, input.Revision = id, expected
		}
	}
	key, err := operationKey()
	if err != nil {
		return nil, err
	}
	var value Definition
	if err := c.request(ctx, method, path, input, &value, expected, key, ""); err != nil {
		return nil, err
	}
	if !ValidID(value.ID) || value.Revision < 1 || id != "" && (value.ID != id || value.Revision != expected+1) {
		return nil, errors.New("Porthole returned an invalid mutation receipt")
	}
	return &value, nil
}

func (c *Client) Archive(ctx context.Context, kind, id string, expected int) error {
	path, err := root(kind)
	if err != nil || !ValidID(id) || expected < 1 {
		return errors.New("archive requires the saved native UUID and revision")
	}
	key, err := operationKey()
	if err != nil {
		return err
	}
	if kind == "dashboard" {
		return c.request(ctx, http.MethodPost, "/app/dashboards/archive", map[string]any{"id": id, "revision": expected}, nil, expected, key, "/app/dashboards/"+id)
	}
	return c.request(ctx, http.MethodDelete, path+"/"+id, map[string]any{}, nil, expected, key, "")
}
