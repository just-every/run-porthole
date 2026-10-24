This provider manages native Porthole monitors and dashboards. It imports their
UUIDs, refreshes native edits, and sends the saved revision with each update.
Destroy archives the definition. Monitor definitions are created inactive;
activation remains a separate native action. The provider does not translate
Datadog modules or implement other resource families.

Authentication comes exclusively from `PORTHOLE_SESSION`, containing the native
installation cookie header. Obtain it through the existing authenticated
installation workflow and inject it into the Terraform process environment.
Do not put the cookie in HCL, arguments, variable files, plan files or state.
The provider schema contains only `origin`; it exposes no credential attribute.
The server checks the current member, session, scope and revision on every call.

The provider requires Go 1.25.0 or later to build and uses the pinned official
HashiCorp Plugin SDK v2.36.1. Terraform 1.5 or later supports the shown import
blocks. Build from this directory:

```sh
nice -n 15 go mod tidy
nice -n 15 go build -p 2 -o ./bin/terraform-provider-porthole .
```

For local development, put this in a private CLI configuration file. Replace
the absolute directory with the provider's actual build directory:

```hcl
provider_installation {
  dev_overrides {
    "registry.terraform.io/just-every/porthole" = "/absolute/checkout/terraform-provider-porthole/bin"
  }
}
```

Set `TF_CLI_CONFIG_FILE` to that file's absolute path. Use the configuration in
[./examples/main.tf](./examples/main.tf), with the real installation origin in
`TF_VAR_origin`. An isolated configuration using only the development provider
can run the commands below directly; `terraform init` still attempts registry
version selection even with a development override.

```sh
terraform -chdir=./examples plan -out=./create.tfplan
terraform -chdir=./examples apply ./create.tfplan
terraform -chdir=./examples plan -detailed-exitcode
```

The last command must exit zero after a successful apply. For a native object
that already exists, first make its HCL match the actual native name, scope and
body, then import its UUID:

```sh
terraform -chdir=./examples import porthole_monitor.checkout NATIVE_MONITOR_UUID
terraform -chdir=./examples import porthole_dashboard.checkout NATIVE_DASHBOARD_UUID
terraform -chdir=./examples plan -detailed-exitcode
```

Alternatively use import blocks with the same addresses and native UUIDs:

```hcl
import {
  to = porthole_monitor.checkout
  id = "NATIVE_MONITOR_UUID"
}
import {
  to = porthole_dashboard.checkout
  id = "NATIVE_DASHBOARD_UUID"
}
```

To exercise concurrency, change the HCL name and save a plan, then edit that
same object in the native UI before applying the saved plan. The apply must
refuse the stale revision. A new plan refreshes the native edit and shows the
proposed reconciliation; update HCL to retain the native edit when desired.
JSON object formatting and key order are normalized without hiding body changes.

The HTTP client has a thirty-second timeout, an 8192-byte request bound and a
two-megabyte response bound. It follows no redirects and never logs request
headers or raw error responses. Dashboard archive accepts only the native
same-origin redirect without following it. Mutations are not retried after a
transport failure: inspect the native object before repeating an uncertain
create. Revocation or a narrowed native role takes effect on the next request.

Implementation references: HashiCorp's [SDK import guidance](https://developer.hashicorp.com/terraform/plugin/sdkv2/resources/import),
[custom difference guidance](https://developer.hashicorp.com/terraform/plugin/sdkv2/resources/customizing-differences),
and [development override documentation](https://developer.hashicorp.com/terraform/cli/config/config-file).
