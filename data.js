// Millage rates extracted from "Allegheny County Rates.xlsx" and "Butler County Rates.xlsx"
// muniMills/schoolMills are mills applied to ASSESSED value (assessed = market value x county assessment ratio)

const COUNTY_DEFAULTS = {
  allegheny: {
    label: "Allegheny County",
    countyMillage: 4.73,
    // Allegheny's STEB Common Level Ratio, published directly as assessed/market %
    ratioPercent: 52,
    ratioNote: "Allegheny STEB Common Level Ratio (~52% as of 2025) — verify current figure before relying on this.",
  },
  butler: {
    label: "Butler County",
    // Not verified — Butler's county millage is applied to 1969 base-year assessed values,
    // a very different magnitude than Allegheny. Enter the current rate before relying on this.
    countyMillage: 0,
    // Butler's STEB Common Level Ratio is published as a divisor factor (16.67 for 7/2025-6/2026),
    // i.e. assessed = market / 16.67. Converted here to an equivalent assessed/market percentage.
    ratioPercent: +(100 / 16.67).toFixed(2),
    ratioNote: "Derived from Butler County's STEB CLR factor of 16.67 (effective 7/2025-6/2026): 100/16.67 ≈ 6.0%. Verify current factor before relying on this.",
  },
};

const MILLAGE_DATA = [
  // --- Allegheny County ---
  { county: "allegheny", region: "CENTRAL / CITY", muni: "City of Pittsburgh", school: "Pittsburgh Public", muniMills: 8.06, schoolMills: 10.457, eitDefault: 3 },
  { county: "allegheny", region: "NORTH", muni: "Aleppo Township", school: "Quaker Valley", muniMills: 3.5, schoolMills: 22.075 },
  { county: "allegheny", region: "NORTH", muni: "Bell Acres Borough", school: "Quaker Valley", muniMills: 5.07, schoolMills: 22.075 },
  { county: "allegheny", region: "NORTH", muni: "Bellevue Borough", school: "Northgate", muniMills: 5.89, schoolMills: 26.7 },
  { county: "allegheny", region: "NORTH", muni: "Avalon Borough", school: "Northgate", muniMills: 9.83, schoolMills: 26.7 },
  { county: "allegheny", region: "NORTH", muni: "Ben Avon Borough", school: "Avonworth", muniMills: 5.5, schoolMills: 23.05 },
  { county: "allegheny", region: "NORTH", muni: "McCandless Township", school: "North Allegheny", muniMills: 2.94, schoolMills: 19.111 },
  { county: "allegheny", region: "NORTH", muni: "Ross Township", school: "North Hills", muniMills: 2.78, schoolMills: 20.37 },
  { county: "allegheny", region: "NORTH", muni: "West View Borough", school: "North Hills", muniMills: 5.5, schoolMills: 20.37 },
  { county: "allegheny", region: "NORTH", muni: "Pine Township", school: "Pine-Richland", muniMills: 0.99, schoolMills: 20.623 },
  { county: "allegheny", region: "NORTH", muni: "Hampton Township", school: "Hampton Area", muniMills: 3.21, schoolMills: 23.92 },
  { county: "allegheny", region: "SOUTH", muni: "Bethel Park Municipality", school: "Bethel Park", muniMills: 4.13, schoolMills: 27.326 },
  { county: "allegheny", region: "SOUTH", muni: "Castle Shannon Borough", school: "Keystone Oaks", muniMills: 12.158, schoolMills: 21.944 },
  { county: "allegheny", region: "SOUTH", muni: "Dormont Borough", school: "Keystone Oaks", muniMills: 14.5, schoolMills: 21.944 },
  { county: "allegheny", region: "SOUTH", muni: "Mt. Lebanon Municipality", school: "Mt. Lebanon", muniMills: 4.93, schoolMills: 32.033 },
  { county: "allegheny", region: "SOUTH", muni: "Baldwin Borough", school: "Baldwin-Whitehall", muniMills: 8.03, schoolMills: 26.175 },
  { county: "allegheny", region: "SOUTH", muni: "Whitehall Borough", school: "Baldwin-Whitehall", muniMills: 5.25, schoolMills: 26.175 },
  { county: "allegheny", region: "SOUTH", muni: "Upper St. Clair Township", school: "Upper St. Clair", muniMills: 3.83, schoolMills: 29.541 },
  { county: "allegheny", region: "SOUTH", muni: "Scott Township", school: "Chartiers Valley", muniMills: 5.3, schoolMills: 20.191 },
  { county: "allegheny", region: "SOUTH", muni: "Bridgeville Borough", school: "Chartiers Valley", muniMills: 8.25, schoolMills: 20.191 },
  { county: "allegheny", region: "EAST", muni: "Monroeville Municipality", school: "Gateway", muniMills: 4.25, schoolMills: 25.272 },
  { county: "allegheny", region: "EAST", muni: "Penn Hills Municipality", school: "Penn Hills", muniMills: 6.44, schoolMills: 31.056 },
  { county: "allegheny", region: "EAST", muni: "Fox Chapel Borough", school: "Fox Chapel Area", muniMills: 2.95, schoolMills: 22.68 },
  { county: "allegheny", region: "EAST", muni: "Plum Borough", school: "Plum Borough", muniMills: 4.78, schoolMills: 23.916 },
  { county: "allegheny", region: "EAST", muni: "Churchill Borough", school: "Woodland Hills", muniMills: 9, schoolMills: 27.35 },
  { county: "allegheny", region: "EAST", muni: "Wilkinsburg Borough", school: "Wilkinsburg", muniMills: 14, schoolMills: 29.5 },
  { county: "allegheny", region: "WEST", muni: "Moon Township", school: "Moon Area", muniMills: 2.74, schoolMills: 25.283 },
  { county: "allegheny", region: "WEST", muni: "Robinson Township", school: "Montour", muniMills: 2.89, schoolMills: 17.964 },
  { county: "allegheny", region: "WEST", muni: "Kennedy Township", school: "Montour", muniMills: 2.75, schoolMills: 17.964 },
  { county: "allegheny", region: "WEST", muni: "Findlay Township", school: "West Allegheny", muniMills: 1.65, schoolMills: 18.51 },
  { county: "allegheny", region: "WEST", muni: "North Fayette Township", school: "West Allegheny", muniMills: 3.39, schoolMills: 18.51 },
  { county: "allegheny", region: "MON VALLEY", muni: "City of Clairton", school: "Clairton City", muniMills: 40, schoolMills: 35 },
  { county: "allegheny", region: "MON VALLEY", muni: "City of Duquesne", school: "Duquesne City", muniMills: 20, schoolMills: 17 },
  { county: "allegheny", region: "MON VALLEY", muni: "West Mifflin Borough", school: "West Mifflin Area", muniMills: 9.61, schoolMills: 28.614 },
  { county: "allegheny", region: "MON VALLEY", muni: "McKeesport City", school: "McKeesport Area", muniMills: 8.26, schoolMills: 20.96 },

  // --- Butler County (2026) ---
  { county: "butler", region: "THE SOUTH (High Growth)", muni: "Cranberry Township", school: "Seneca Valley", muniMills: 15.75, schoolMills: 134.5 },
  { county: "butler", region: "THE SOUTH (High Growth)", muni: "Adams Township", school: "Mars Area", muniMills: 7, schoolMills: 104.5 },
  { county: "butler", region: "THE SOUTH (High Growth)", muni: "Middlesex Township", school: "Mars Area", muniMills: 4.5, schoolMills: 104.5 },
  { county: "butler", region: "THE SOUTH (High Growth)", muni: "Jackson Township", school: "Seneca Valley", muniMills: 2.5, schoolMills: 134.5 },
  { county: "butler", region: "THE SOUTH (High Growth)", muni: "Forward Township", school: "Seneca Valley", muniMills: 8, schoolMills: 134.5 },
  { county: "butler", region: "THE SOUTH (High Growth)", muni: "Evans City Borough", school: "Seneca Valley", muniMills: 14.7, schoolMills: 134.5 },
  { county: "butler", region: "THE SOUTH (High Growth)", muni: "Zelienople Borough", school: "Seneca Valley", muniMills: 7.31, schoolMills: 134.5 },
  { county: "butler", region: "CENTRAL / CITY", muni: "City of Butler", school: "Butler Area", muniMills: 32.6, schoolMills: 109.15 },
  { county: "butler", region: "CENTRAL / CITY", muni: "Butler Township", school: "Butler Area", muniMills: 11.25, schoolMills: 109.15 },
  { county: "butler", region: "CENTRAL / CITY", muni: "Center Township", school: "Butler Area", muniMills: 2, schoolMills: 109.15 },
  { county: "butler", region: "CENTRAL / CITY", muni: "Connoquenessing Township", school: "Butler Area", muniMills: 5, schoolMills: 109.15 },
  { county: "butler", region: "CENTRAL / CITY", muni: "Penn Township", school: "South Butler (Knoch)", muniMills: 9, schoolMills: 97.45 },
  { county: "butler", region: "EAST / AK VALLEY", muni: "Buffalo Township", school: "Freeport Area", muniMills: 16.5, schoolMills: 185.91 },
  { county: "butler", region: "EAST / AK VALLEY", muni: "Winfield Township", school: "South Butler (Knoch)", muniMills: 6, schoolMills: 97.45 },
  { county: "butler", region: "EAST / AK VALLEY", muni: "Clinton Township", school: "South Butler (Knoch)", muniMills: 7, schoolMills: 97.45 },
  { county: "butler", region: "EAST / AK VALLEY", muni: "Saxonburg Borough", school: "South Butler (Knoch)", muniMills: 13.5, schoolMills: 97.45 },
  { county: "butler", region: "NORTH", muni: "Slippery Rock Township", school: "Slippery Rock Area", muniMills: 5, schoolMills: 101.5 },
  { county: "butler", region: "NORTH", muni: "Slippery Rock Borough", school: "Slippery Rock Area", muniMills: 14, schoolMills: 101.5 },
  { county: "butler", region: "NORTH", muni: "Harrisville Borough", school: "Slippery Rock Area", muniMills: 13.5, schoolMills: 101.5 },
];
