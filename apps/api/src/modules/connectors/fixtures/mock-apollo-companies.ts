

export interface ApolloJobPosting {
  title: string;
  department: string;
  daysAgo: number;
}

export interface ApolloPersonFixture {
  name: string;
  title: string;
  seniority: string;
  department: string;
  email: string;
}

export interface ApolloCompanyFixture {
  id: string;
  name: string;
  domain: string;
  industryRaw: string;
  countryRaw: string;
  city: string;
  state?: string;
  description: string;
  employeeCount?: number;
  revenueUsd?: number;
  foundedYear: number;
  fundingStage: string;
  totalFundingUsd: number;
  stackRaw: string[];
  stackAuthoritative: boolean;
  hiring: ApolloJobPosting[];
  hiringAuthoritative: boolean;
  people: ApolloPersonFixture[];
}

export const MOCK_APOLLO_COMPANIES: ApolloCompanyFixture[] = [
  {
    id: "databricks",
    name: "Databricks",
    domain: "databricks.com",
    industryRaw: "Software",
    countryRaw: "United States",
    city: "San Francisco",
    state: "CA",
    description: "Data intelligence platform unifying data, analytics and AI.",
    employeeCount: 7000,
    revenueUsd: 1_600_000_000,
    foundedYear: 2013,
    fundingStage: "series_d_plus",
    totalFundingUsd: 4_000_000_000,
    stackRaw: ["Salesforce CRM", "Marketo", "Workday"],
    stackAuthoritative: true,
    hiring: [
      { title: "Enterprise Account Executive", department: "sales", daysAgo: 12 },
      { title: "Sales Development Representative", department: "sales", daysAgo: 20 },
    ],
    hiringAuthoritative: true,
    people: [{ name: "Priya Raman", title: "VP Sales, Enterprise", seniority: "vp", department: "sales", email: "priya.raman@databricks.example" }],
  },
  {
    id: "notion",
    name: "Notion",
    domain: "notion.so",
    industryRaw: "SaaS",
    countryRaw: "USA",
    city: "San Francisco",
    state: "CA",
    description: "Connected workspace for docs, wikis and projects.",
    employeeCount: 480,

    foundedYear: 2013,
    fundingStage: "series_c",
    totalFundingUsd: 343_000_000,
    stackRaw: ["Salesforce", "Gong", "Outreach"],
    stackAuthoritative: true,
    hiring: [
      { title: "Account Executive, Mid-Market", department: "sales", daysAgo: 9 },
      { title: "Sales Manager, SMB", department: "sales", daysAgo: 31 },
    ],
    hiringAuthoritative: true,
    people: [
      { name: "Daniel Okafor", title: "VP Sales", seniority: "vp", department: "sales", email: "daniel.okafor@notion.example" },
      { name: "Mei Tanaka", title: "Head of Revenue Operations", seniority: "director", department: "sales", email: "mei.tanaka@notion.example" },
    ],
  },
  {
    id: "figma",
    name: "Figma",
    domain: "figma.com",
    industryRaw: "Computer Software",
    countryRaw: "United States",
    city: "San Francisco",
    state: "CA",
    description: "Collaborative interface design platform.",
    employeeCount: 1300,
    revenueUsd: 600_000_000,
    foundedYear: 2012,
    fundingStage: "series_d_plus",
    totalFundingUsd: 333_000_000,
    stackRaw: ["Salesforce Sales Cloud", "Gainsight"],
    stackAuthoritative: true,
    hiring: [{ title: "Account Executive, Enterprise", department: "sales", daysAgo: 5 }],
    hiringAuthoritative: true,
    people: [{ name: "Lucas Moreau", title: "Director of Sales", seniority: "director", department: "sales", email: "lucas.moreau@figma.example" }],
  },
  {
    id: "canva",
    name: "Canva",
    domain: "canva.com",
    industryRaw: "SaaS",
    countryRaw: "Australia",
    city: "Sydney",
    state: "NSW",
    description: "Online visual communication and design platform.",
    employeeCount: 4500,
    revenueUsd: 2_000_000_000,
    foundedYear: 2013,
    fundingStage: "series_d_plus",
    totalFundingUsd: 580_000_000,
    stackRaw: ["HubSpot CRM", "Zendesk"],
    stackAuthoritative: true,
    hiring: [{ title: "Enterprise Account Executive", department: "sales", daysAgo: 14 }],
    hiringAuthoritative: true,
    people: [{ name: "Sophie Nguyen", title: "Head of Sales, APAC", seniority: "director", department: "sales", email: "sophie.nguyen@canva.example" }],
  },
  {
    id: "stripe",
    name: "Stripe",
    domain: "stripe.com",
    industryRaw: "Financial Services",
    countryRaw: "U.S.",
    city: "San Francisco",
    state: "CA",
    description: "Financial infrastructure platform for the internet.",
    employeeCount: 8000,
    revenueUsd: 5_000_000_000,
    foundedYear: 2010,
    fundingStage: "series_d_plus",
    totalFundingUsd: 8_700_000_000,
    stackRaw: ["Salesforce", "Marketo"],
    stackAuthoritative: true,
    hiring: [{ title: "Account Executive, Startups", department: "sales", daysAgo: 3 }],
    hiringAuthoritative: true,
    people: [{ name: "Amara Osei", title: "VP Sales, Americas", seniority: "vp", department: "sales", email: "amara.osei@stripe.example" }],
  },
  {
    id: "linear",
    name: "Linear",
    domain: "linear.app",
    industryRaw: "B2B SaaS",
    countryRaw: "United States",
    city: "San Francisco",
    state: "CA",
    description: "Issue tracking and product planning for modern software teams.",

    foundedYear: 2019,
    fundingStage: "series_b",
    totalFundingUsd: 52_000_000,
    stackRaw: [],
    stackAuthoritative: false,
    hiring: [],
    hiringAuthoritative: true,
    people: [{ name: "Jonas Lindqvist", title: "Head of Go-to-Market", seniority: "director", department: "sales", email: "jonas.lindqvist@linear.example" }],
  },
  {
    id: "webflow",
    name: "Webflow",
    domain: "webflow.com",
    industryRaw: "SaaS",
    countryRaw: "United States of America",
    city: "San Francisco",
    state: "CA",
    description: "Visual web development platform for designers and marketers.",
    employeeCount: 450,

    foundedYear: 2013,
    fundingStage: "series_c",
    totalFundingUsd: 335_000_000,
    stackRaw: ["Salesforce", "HubSpot Marketing Hub", "6sense"],
    stackAuthoritative: true,
    hiring: [
      { title: "Account Executive, Enterprise", department: "sales", daysAgo: 7 },
      { title: "Sales Development Representative", department: "sales", daysAgo: 18 },
    ],
    hiringAuthoritative: true,
    people: [
      { name: "Hannah Cole", title: "VP Sales", seniority: "vp", department: "sales", email: "hannah.cole@webflow.example" },
      { name: "Ravi Menon", title: "Director, Revenue Operations", seniority: "director", department: "sales", email: "ravi.menon@webflow.example" },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    domain: "slack.com",
    industryRaw: "Software",
    countryRaw: "United States",
    city: "San Francisco",
    state: "CA",
    description: "Messaging platform for teams.",
    employeeCount: 2500,
    revenueUsd: 1_500_000_000,
    foundedYear: 2009,
    fundingStage: "acquired",
    totalFundingUsd: 1_400_000_000,
    stackRaw: ["Salesforce", "Marketo"],
    stackAuthoritative: true,
    hiring: [
      { title: "Senior Software Engineer, Infrastructure", department: "engineering", daysAgo: 4 },
      { title: "Staff Engineer, Search", department: "engineering", daysAgo: 11 },
    ],
    hiringAuthoritative: true,
    people: [{ name: "Grace Whitfield", title: "VP Sales", seniority: "vp", department: "sales", email: "grace.whitfield@slack.example" }],
  },
];

export function toApolloRawPayload(f: ApolloCompanyFixture): Record<string, unknown> {

  const now = new Date(new Date().toISOString().slice(0, 10)).getTime();
  return {
    id: `mock_${f.id}`,
    name: f.name,
    website_url: `https://www.${f.domain}`,
    primary_domain: f.domain,
    industry: f.industryRaw,
    short_description: f.description,
    country: f.countryRaw,
    city: f.city,
    state: f.state ?? null,
    estimated_num_employees: f.employeeCount ?? null,
    annual_revenue: f.revenueUsd ?? null,
    founded_year: f.foundedYear,
    latest_funding_stage: f.fundingStage,
    total_funding: f.totalFundingUsd,
    technologies: f.stackRaw.map((raw) => ({ name: raw })),
    technologies_complete: f.stackAuthoritative,
    job_postings: f.hiring.map((h) => ({
      title: h.title,
      department: h.department,
      posted_at: new Date(now - h.daysAgo * 86_400_000).toISOString(),
      url: `https://jobs.${f.domain}/${h.title.toLowerCase().replace(/[^a-z]+/g, "-")}`,
    })),
    job_postings_complete: f.hiringAuthoritative,
    people: f.people.map((p) => ({ name: p.name, title: p.title, seniority: p.seniority, department: p.department, email: p.email })),
  };
}
