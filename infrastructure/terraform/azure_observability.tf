# Azure Multi-Region Observability Pipeline - Terraform
# This IaC provisions a central Hub and multiple Regional Spokes.
# It provisions Log Analytics Workspaces, Azure Monitor Workspaces (PaaS for app),
# Data Collection Rules (DCR), Data Collection Endpoints (DCE),
# and Network Security Groups (NSG for infra).

terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

variable "hub_region" {
  default = "eastus"
}

variable "spoke_regions" {
  type    = list(string)
  default = ["westeurope", "southeastasia"]
}

resource "azurerm_resource_group" "observability" {
  name     = "rg-global-observability"
  location = var.hub_region
}

# ---------------------------------------------------------
# CENTRAL HUB (App Insights, AMW, Central LAW)
# ---------------------------------------------------------
resource "azurerm_log_analytics_workspace" "hub_law" {
  name                = "law-central-hub"
  location            = var.hub_region
  resource_group_name = azurerm_resource_group.observability.name
  sku                 = "PerGB2018"
  retention_in_days   = 90
}

# Azure Monitor Workspace (PaaS for Application Metrics/Prometheus)
resource "azurerm_monitor_workspace" "central_amw" {
  name                = "amw-central-hub"
  location            = var.hub_region
  resource_group_name = azurerm_resource_group.observability.name
}

# Workspace-based Application Insights (PaaS for Application Traces)
resource "azurerm_application_insights" "central_app_insights" {
  name                = "appi-central-hub"
  location            = var.hub_region
  resource_group_name = azurerm_resource_group.observability.name
  workspace_id        = azurerm_log_analytics_workspace.hub_law.id
  application_type    = "web"
}

# ---------------------------------------------------------
# REGIONAL SPOKES (DCE, DCR, NSG, Regional LAW)
# ---------------------------------------------------------
resource "azurerm_log_analytics_workspace" "spoke_law" {
  count               = length(var.spoke_regions)
  name                = "law-spoke-${var.spoke_regions[count.index]}"
  location            = var.spoke_regions[count.index]
  resource_group_name = azurerm_resource_group.observability.name
  sku                 = "PerGB2018"
  retention_in_days   = 30 # Lower retention at edge
}

# Network Security Group for Infrastructure (Regional)
resource "azurerm_network_security_group" "spoke_nsg" {
  count               = length(var.spoke_regions)
  name                = "nsg-infra-${var.spoke_regions[count.index]}"
  location            = var.spoke_regions[count.index]
  resource_group_name = azurerm_resource_group.observability.name

  # Allow outbound traffic to Azure Monitor
  security_rule {
    name                       = "AllowAzureMonitorOutbound"
    priority                   = 100
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "AzureMonitor"
  }
}

# Data Collection Endpoints (Regional)
resource "azurerm_monitor_data_collection_endpoint" "spoke_dce" {
  count               = length(var.spoke_regions)
  name                = "dce-spoke-${var.spoke_regions[count.index]}"
  location            = var.spoke_regions[count.index]
  resource_group_name = azurerm_resource_group.observability.name
  public_network_access_enabled = true
}

# Data Collection Rules (Regional)
resource "azurerm_monitor_data_collection_rule" "spoke_dcr" {
  count               = length(var.spoke_regions)
  name                = "dcr-spoke-${var.spoke_regions[count.index]}"
  location            = var.spoke_regions[count.index]
  resource_group_name = azurerm_resource_group.observability.name
  data_collection_endpoint_id = azurerm_monitor_data_collection_endpoint.spoke_dce[count.index].id

  destinations {
    log_analytics {
      workspace_resource_id = azurerm_log_analytics_workspace.spoke_law[count.index].id
      name                  = "regional_law_dest"
    }
    azure_monitor_metrics {
      name = "regional_metrics_dest"
    }
  }

  data_flow {
    streams      = ["Microsoft-Syslog", "Microsoft-Perf"]
    destinations = ["regional_law_dest"]
  }

  data_flow {
    streams      = ["Microsoft-InsightsMetrics"]
    destinations = ["regional_metrics_dest"]
  }

  data_sources {
    syslog {
      name           = "syslogDataSource"
      facility_names = ["*"]
      log_levels     = ["Alert", "Critical", "Emergency", "Error"]
      streams        = ["Microsoft-Syslog"]
    }
    performance_counter {
      name          = "perfDataSource"
      streams       = ["Microsoft-Perf", "Microsoft-InsightsMetrics"]
      sampling_frequency_in_seconds = 60
      counter_specifiers = [
        "\\Processor(_Total)\\% Processor Time",
        "\\Memory\\Available Bytes"
      ]
    }
  }
}
