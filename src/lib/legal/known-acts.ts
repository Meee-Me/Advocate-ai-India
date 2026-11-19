/**
 * Major central Indian statutes, as "name|year". Used only to flag Act names that
 * the built-in list does not recognise; it is NOT a complete register (state Acts,
 * rules, ordinances and many central Acts are absent), so an unrecognised name is
 * "verify", never "fake". Only entries that are certain belong here.
 */
const LIST = [
  'Indian Penal Code|1860', 'Code of Criminal Procedure|1973', 'Code of Civil Procedure|1908', 'Indian Evidence Act|1872',
  'Bharatiya Nyaya Sanhita|2023', 'Bharatiya Nagarik Suraksha Sanhita|2023', 'Bharatiya Sakshya Adhiniyam|2023',
  'Indian Contract Act|1872', 'Transfer of Property Act|1882', 'Specific Relief Act|1963', 'Limitation Act|1963',
  'Negotiable Instruments Act|1881', 'Indian Succession Act|1925', 'Indian Easements Act|1882', 'Indian Stamp Act|1899',
  'Registration Act|1908', 'Indian Partnership Act|1932', 'Sale of Goods Act|1930', 'General Clauses Act|1897',
  'Hindu Marriage Act|1955', 'Hindu Succession Act|1956', 'Hindu Minority and Guardianship Act|1956',
  'Hindu Adoptions and Maintenance Act|1956', 'Special Marriage Act|1954', 'Guardians and Wards Act|1890',
  'Indian Divorce Act|1869', 'Indian Christian Marriage Act|1872', 'Parsi Marriage and Divorce Act|1936',
  'Muslim Women (Protection of Rights on Divorce) Act|1986', 'Muslim Women (Protection of Rights on Marriage) Act|2019',
  'Protection of Women from Domestic Violence Act|2005', 'Dowry Prohibition Act|1961',
  'Maintenance and Welfare of Parents and Senior Citizens Act|2007',
  'Protection of Children from Sexual Offences Act|2012', 'Juvenile Justice (Care and Protection of Children) Act|2015',
  'Narcotic Drugs and Psychotropic Substances Act|1985', 'Prevention of Corruption Act|1988',
  'Prevention of Money Laundering Act|2002', 'Unlawful Activities (Prevention) Act|1967', 'Arms Act|1959',
  'Probation of Offenders Act|1958', 'Contempt of Courts Act|1971', 'Protection of Human Rights Act|1993',
  'Scheduled Castes and the Scheduled Tribes (Prevention of Atrocities) Act|1989',
  'Consumer Protection Act|2019', 'Consumer Protection Act|1986', 'Information Technology Act|2000',
  'Digital Personal Data Protection Act|2023', 'Right to Information Act|2005', 'Motor Vehicles Act|1988',
  'Arbitration and Conciliation Act|1996', 'Companies Act|2013', 'Companies Act|1956', 'Limited Liability Partnership Act|2008',
  'Competition Act|2002', 'Securities and Exchange Board of India Act|1992', 'Foreign Exchange Management Act|1999',
  'Real Estate (Regulation and Development) Act|2016',
  'Right to Fair Compensation and Transparency in Land Acquisition, Rehabilitation and Resettlement Act|2013',
  'Environment (Protection) Act|1986', 'Water (Prevention and Control of Pollution) Act|1974',
  'Industrial Disputes Act|1947', 'Minimum Wages Act|1948', 'Factories Act|1948', 'Payment of Gratuity Act|1972',
  'Employees\' Compensation Act|1923', 'Advocates Act|1961', 'Trade Marks Act|1999', 'Copyright Act|1957', 'Patents Act|1970',
  'Representation of the People Act|1951', 'Code of Criminal Procedure (Amendment) Act|2008',
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const KNOWN_ACTS = new Set(LIST.map((e) => { const [n, y] = e.split('|'); return `${norm(n)}|${y}`; }));
export const isKnownAct = (name: string, year: string) => KNOWN_ACTS.has(`${norm(name.replace(/^the\s+/i, ''))}|${year}`);
