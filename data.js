// Millage rates from "Allegheny County Rates.xlsx" — Allegheny County, PA ONLY.
// This app is scoped exclusively to Allegheny County; the county-level baseline
// millage and assessment constants live in tax.js (AlleghenyTax).
// muniMills/schoolMills are mills applied to ASSESSED value.
// Re-verified 2026-07-17 against apps.alleghenycounty.us/website/MillMuni.asp (municipal mills)
// and qvsd.org Tax Information (school mills: 22.8469 mills for the 2026-2027 school year).
// County baseline mills (6.43, effective 2025) live in tax.js, not here.

const MILLAGE_DATA = [
  { region: "CENTRAL / CITY", muni: "City of Pittsburgh", school: "Pittsburgh Public", muniMills: 8.06, schoolMills: 10.457, eitDefault: 3 },
  { region: "NORTH", muni: "Aleppo Township", school: "Quaker Valley", muniMills: 3.5, schoolMills: 22.8469 },
  { region: "NORTH", muni: "Bell Acres Borough", school: "Quaker Valley", muniMills: 4.82, schoolMills: 22.8469 },
  { region: "NORTH", muni: "Sewickley Borough", school: "Quaker Valley", muniMills: 6.25, schoolMills: 22.8469 },
  { region: "NORTH", muni: "Edgeworth Borough", school: "Quaker Valley", muniMills: 4.15, schoolMills: 22.8469 },
  { region: "NORTH", muni: "Sewickley Heights Borough", school: "Quaker Valley", muniMills: 5.50, schoolMills: 22.8469 },
  { region: "NORTH", muni: "Sewickley Hills Borough", school: "Quaker Valley", muniMills: 2.84, schoolMills: 22.8469 },
  { region: "NORTH", muni: "Glen Osborne Borough", school: "Quaker Valley", muniMills: 4.90, schoolMills: 22.8469 },
  { region: "NORTH", muni: "Glenfield Borough", school: "Quaker Valley", muniMills: 4.15, schoolMills: 22.8469 },
  { region: "NORTH", muni: "Haysville Borough", school: "Quaker Valley", muniMills: 6.063, schoolMills: 22.8469 },
  { region: "NORTH", muni: "Leet Township", school: "Quaker Valley", muniMills: 9.10, schoolMills: 22.8469 },
  { region: "NORTH", muni: "Leetsdale Borough", school: "Quaker Valley", muniMills: 9.00, schoolMills: 22.8469 },
  { region: "NORTH", muni: "Bellevue Borough", school: "Northgate", muniMills: 5.89, schoolMills: 26.7 },
  { region: "NORTH", muni: "Avalon Borough", school: "Northgate", muniMills: 9.83, schoolMills: 26.7 },
  { region: "NORTH", muni: "Ben Avon Borough", school: "Avonworth", muniMills: 5.5, schoolMills: 23.05 },
  { region: "NORTH", muni: "McCandless Township", school: "North Allegheny", muniMills: 2.94, schoolMills: 19.111 },
  { region: "NORTH", muni: "Ross Township", school: "North Hills", muniMills: 2.78, schoolMills: 20.37 },
  { region: "NORTH", muni: "West View Borough", school: "North Hills", muniMills: 5.5, schoolMills: 20.37 },
  { region: "NORTH", muni: "Pine Township", school: "Pine-Richland", muniMills: 0.99, schoolMills: 20.623 },
  { region: "NORTH", muni: "Hampton Township", school: "Hampton Area", muniMills: 3.21, schoolMills: 23.92 },
  { region: "SOUTH", muni: "Bethel Park Municipality", school: "Bethel Park", muniMills: 4.13, schoolMills: 27.326 },
  { region: "SOUTH", muni: "Castle Shannon Borough", school: "Keystone Oaks", muniMills: 12.158, schoolMills: 21.944 },
  { region: "SOUTH", muni: "Dormont Borough", school: "Keystone Oaks", muniMills: 14.5, schoolMills: 21.944 },
  { region: "SOUTH", muni: "Mt. Lebanon Municipality", school: "Mt. Lebanon", muniMills: 4.93, schoolMills: 32.033 },
  { region: "SOUTH", muni: "Baldwin Borough", school: "Baldwin-Whitehall", muniMills: 8.03, schoolMills: 26.175 },
  { region: "SOUTH", muni: "Whitehall Borough", school: "Baldwin-Whitehall", muniMills: 5.25, schoolMills: 26.175 },
  { region: "SOUTH", muni: "Upper St. Clair Township", school: "Upper St. Clair", muniMills: 3.83, schoolMills: 29.541 },
  { region: "SOUTH", muni: "Scott Township", school: "Chartiers Valley", muniMills: 5.3, schoolMills: 20.191 },
  { region: "SOUTH", muni: "Bridgeville Borough", school: "Chartiers Valley", muniMills: 8.25, schoolMills: 20.191 },
  { region: "EAST", muni: "Monroeville Municipality", school: "Gateway", muniMills: 4.25, schoolMills: 25.272 },
  { region: "EAST", muni: "Penn Hills Municipality", school: "Penn Hills", muniMills: 6.44, schoolMills: 31.056 },
  { region: "EAST", muni: "Fox Chapel Borough", school: "Fox Chapel Area", muniMills: 2.95, schoolMills: 22.68 },
  { region: "EAST", muni: "Plum Borough", school: "Plum Borough", muniMills: 4.78, schoolMills: 23.916 },
  { region: "EAST", muni: "Churchill Borough", school: "Woodland Hills", muniMills: 9, schoolMills: 27.35 },
  { region: "EAST", muni: "Wilkinsburg Borough", school: "Wilkinsburg", muniMills: 14, schoolMills: 29.5 },
  { region: "WEST", muni: "Moon Township", school: "Moon Area", muniMills: 2.74, schoolMills: 25.283 },
  { region: "WEST", muni: "Robinson Township", school: "Montour", muniMills: 2.89, schoolMills: 17.964 },
  { region: "WEST", muni: "Kennedy Township", school: "Montour", muniMills: 2.75, schoolMills: 17.964 },
  { region: "WEST", muni: "Findlay Township", school: "West Allegheny", muniMills: 1.65, schoolMills: 18.51 },
  { region: "WEST", muni: "North Fayette Township", school: "West Allegheny", muniMills: 3.39, schoolMills: 18.51 },
  { region: "MON VALLEY", muni: "City of Clairton", school: "Clairton City", muniMills: 40, schoolMills: 35 },
  { region: "MON VALLEY", muni: "City of Duquesne", school: "Duquesne City", muniMills: 20, schoolMills: 17 },
  { region: "MON VALLEY", muni: "West Mifflin Borough", school: "West Mifflin Area", muniMills: 9.61, schoolMills: 28.614 },
  { region: "MON VALLEY", muni: "McKeesport City", school: "McKeesport Area", muniMills: 8.26, schoolMills: 20.96 },
];
