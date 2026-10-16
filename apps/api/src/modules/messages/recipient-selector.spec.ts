import { selectRecipient } from "./recipient-selector";

describe("selectRecipient", () => {
  it("returns null when no candidate has an email address", () => {
    const result = selectRecipient([{ id: "1", fullName: "Jane Doe", title: "VP Sales", seniority: "vp", email: null }], []);
    expect(result).toBeNull();
  });

  it("excludes candidates without an email even if they otherwise match the persona best", () => {
    const result = selectRecipient(
      [
        { id: "1", fullName: "No Email VP", title: "VP Sales", seniority: "vp", email: null },
        { id: "2", fullName: "Has Email IC", title: "Sales Rep", seniority: "ic", email: "rep@co.com" },
      ],
      [{ title: "VP Sales", seniority: "vp" }],
    );
    expect(result?.id).toBe("2");
  });

  it("prefers the candidate whose title/seniority best matches a target persona", () => {
    const result = selectRecipient(
      [
        { id: "1", fullName: "Random Manager", title: "Office Manager", seniority: "manager", email: "a@co.com" },
        { id: "2", fullName: "VP Sales", title: "VP of Sales", seniority: "vp", email: "b@co.com" },
      ],
      [{ title: "VP Sales", seniority: "vp", department: "sales" }],
    );
    expect(result?.id).toBe("2");
  });

  it("falls back to plain seniority ranking when no persona is given", () => {
    const result = selectRecipient(
      [
        { id: "1", fullName: "IC", title: "Engineer", seniority: "ic", email: "ic@co.com" },
        { id: "2", fullName: "CEO", title: "Chief Executive Officer", seniority: "c_level", email: "ceo@co.com" },
      ],
      [],
    );
    expect(result?.id).toBe("2");
  });
});
