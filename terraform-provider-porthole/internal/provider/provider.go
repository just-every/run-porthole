package provider

import (
	"context"
	"os"

	"github.com/hashicorp/terraform-plugin-sdk/v2/diag"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
	"github.com/just-every/run-porthole/terraform-provider-porthole/internal/client"
)

func New() *schema.Provider {
	return &schema.Provider{
		Schema: map[string]*schema.Schema{
			"origin": {
				Type: schema.TypeString, Required: true,
				Description: "HTTPS installation origin. HTTP is allowed only on loopback. Native session authority is read only from PORTHOLE_SESSION.",
				ValidateFunc: func(value interface{}, _ string) ([]string, []error) {
					_, err := client.ValidateOrigin(value.(string))
					if err != nil {
						return nil, []error{err}
					}
					return nil, nil
				},
			},
		},
		ResourcesMap: map[string]*schema.Resource{
			"porthole_monitor":   definitionResource("monitor"),
			"porthole_dashboard": definitionResource("dashboard"),
		},
		ConfigureContextFunc: func(_ context.Context, data *schema.ResourceData) (interface{}, diag.Diagnostics) {
			connection, err := client.New(data.Get("origin").(string), os.Getenv("PORTHOLE_SESSION"))
			if err != nil {
				return nil, diag.FromErr(err)
			}
			return connection, nil
		},
	}
}
