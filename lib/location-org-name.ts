const LOCATION_ORG_NAMES: Record<string, string> = {
  asI8eHkRqF8RpX1VXhHz: "All About Kindness",
  "4Nzcp3vUgVbOoN9uxu5F": "Church Missions Network",
  g9JSoJ1FInnA6N0SHXi7: "Chabad of North Ranch",
  KVgMIrEYRkKRcfeicJBm: "Just One Life",
  E7yO96aiKmYvsbU2tRzc: "Texas Torah Institute",
  sfhxVFajQpL7HedtX5NK: "Orlando Community Kollel",
  Y8UfZOiGu6H9qh04FebD: "Keren Efrat",
  dGBms4fIfi6WTZbCJeHR: "Kentucky Torah Day School",
  NikJ6tAcHSe8UCLgYMqM: "Benchmark Adventure Ministries",
  "4RFAAkbc9Ap17F4Ow5PI": "Chabad of Kentucky",
  h0RGDXEon3Q4Fu3KlpQC: "Performing Stars of Marin",
  QeDsxMGYS4IJAyVtGPgZ: "Star Senior Solutions",
};

export function getOrganizationNameByLocationId(locationId?: string | null) {
  if (!locationId) {
    return "Organization";
  }

  return LOCATION_ORG_NAMES[locationId] ?? locationId;
}