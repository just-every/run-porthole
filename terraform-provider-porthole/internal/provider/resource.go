package provider

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/hashicorp/terraform-plugin-sdk/v2/diag"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
	"github.com/just-every/run-porthole/terraform-provider-porthole/internal/client"
)

func definitionResource(kind string) *schema.Resource {
	resource := &schema.Resource{
		Description: "A native " + kind + " with live app authorization and revision-conditional mutations. Destroy archives the native definition.",
		Schema: map[string]*schema.Schema{
			"name": {
				Type: schema.TypeString, Required: true,
				Description: "Native definition name.",
			},
			"scope_json":      jsonAttribute("JSON object with services, environments and teams arrays. Scope is checked by the native API on every request."),
			"definition_json": jsonAttribute("Native definition body as a JSON object. JSON object ordering and formatting do not produce drift."),
			"revision": {
				Type: schema.TypeInt, Computed: true,
				Description: "Native revision read during planning. Updates must match that exact revision.",
			},
		},
		Importer: &schema.ResourceImporter{
			StateContext: func(ctx context.Context, data *schema.ResourceData, meta interface{}) ([]*schema.ResourceData, error) {
				if !client.ValidID(data.Id()) {
					return nil, errors.New("import requires the native object UUID")
				}
				return schema.ImportStatePassthroughContext(ctx, data, meta)
			},
		},
		CustomizeDiff: func(_ context.Context, diff *schema.ResourceDiff, _ interface{}) error {
			if diff.HasChange("name") || diff.HasChange("scope_json") || diff.HasChange("definition_json") {
				return diff.SetNewComputed("revision")
			}
			return nil
		},
		EnableLegacyTypeSystemPlanErrors:  true,
		EnableLegacyTypeSystemApplyErrors: true,
	}
	resource.ReadContext = func(ctx context.Context, data *schema.ResourceData, meta interface{}) diag.Diagnostics {
		return readDefinition(ctx, data, meta.(*client.Client), kind)
	}
	resource.CreateContext = func(ctx context.Context, data *schema.ResourceData, meta interface{}) diag.Diagnostics {
		return writeDefinition(ctx, data, meta.(*client.Client), kind, true)
	}
	resource.UpdateContext = func(ctx context.Context, data *schema.ResourceData, meta interface{}) diag.Diagnostics {
		return writeDefinition(ctx, data, meta.(*client.Client), kind, false)
	}
	resource.DeleteContext = func(ctx context.Context, data *schema.ResourceData, meta interface{}) diag.Diagnostics {
		connection := meta.(*client.Client)
		// This read checks existence and archived state only. Its revision must
		// never replace the revision the person approved in the saved plan.
		current, err := connection.Read(ctx, kind, data.Id())
		if missing(err) || err == nil && current.State == "archived" {
			data.SetId("")
			return nil
		}
		if err != nil {
			return diag.FromErr(err)
		}
		if err := connection.Archive(ctx, kind, data.Id(), data.Get("revision").(int)); err != nil {
			return diag.FromErr(err)
		}
		data.SetId("")
		return nil
	}
	return resource
}

func missing(err error) bool {
	var api *client.APIError
	return errors.As(err, &api) && api.Status == 404
}

func readDefinition(ctx context.Context, data *schema.ResourceData, connection *client.Client, kind string) diag.Diagnostics {
	value, err := connection.Read(ctx, kind, data.Id())
	if missing(err) || err == nil && value.State == "archived" {
		data.SetId("")
		return nil
	}
	if err != nil {
		return diag.FromErr(err)
	}
	for key, value := range map[string]interface{}{
		"name":            value.Name,
		"scope_json":      retainedJSON(data.Get("scope_json").(string), string(value.Scope)),
		"definition_json": retainedJSON(data.Get("definition_json").(string), string(value.Body)),
		"revision":        value.Revision,
	} {
		if err := data.Set(key, value); err != nil {
			return diag.Errorf("native %s state could not be stored", kind)
		}
	}
	return nil
}

func writeDefinition(ctx context.Context, data *schema.ResourceData, connection *client.Client, kind string, create bool) diag.Diagnostics {
	id, expected := data.Id(), 0
	if !create {
		// The SDK exposes the refreshed prior state independently from the
		// computed revision in the plan. A saved plan retains this old revision.
		old, _ := data.GetChange("revision")
		expected, _ = old.(int)
	}
	input := client.Input{Name: data.Get("name").(string), Scope: json.RawMessage(data.Get("scope_json").(string)), Body: json.RawMessage(data.Get("definition_json").(string))}
	value, err := connection.Write(ctx, kind, id, expected, input)
	if err != nil {
		return diag.FromErr(err)
	}
	// Retain the committed identity even if the following live read fails.
	data.SetId(value.ID)
	if err := data.Set("revision", value.Revision); err != nil {
		return diag.Errorf("native %s revision could not be stored", kind)
	}
	return readDefinition(ctx, data, connection, kind)
}
