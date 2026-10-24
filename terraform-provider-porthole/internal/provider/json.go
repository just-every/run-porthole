package provider

import (
	"encoding/json"
	"errors"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
)

func normalizeJSON(raw string) (string, error) {
	var object map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &object); err != nil || object == nil {
		return "", errors.New("value must be a JSON object")
	}
	encoded, err := json.Marshal(object)
	if err != nil {
		return "", errors.New("value must be a JSON object")
	}
	return string(encoded), nil
}

func jsonAttribute(description string) *schema.Schema {
	return &schema.Schema{
		Type: schema.TypeString, Required: true, Description: description,
		ValidateFunc: func(value interface{}, _ string) ([]string, []error) {
			if _, err := normalizeJSON(value.(string)); err != nil {
				return nil, []error{err}
			}
			return nil, nil
		},
		DiffSuppressFunc: func(_ string, old, next string, _ *schema.ResourceData) bool {
			a, errA := normalizeJSON(old)
			b, errB := normalizeJSON(next)
			return errA == nil && errB == nil && a == b
		},
		DiffSuppressOnRefresh: true,
	}
}

func retainedJSON(configured, native string) string {
	a, errA := normalizeJSON(configured)
	b, errB := normalizeJSON(native)
	if errA == nil && errB == nil && a == b {
		return configured
	}
	return native
}
