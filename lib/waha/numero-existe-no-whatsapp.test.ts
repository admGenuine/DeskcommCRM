import { describe, expect, it } from "vitest";

import { numeroExisteNoWhatsapp } from "./resolve-contact-whatsapp-id";

describe("número existe no WhatsApp: `false` só quando TODAS as grafias responderam que não", () => {
  it("true quando alguma grafia existe", async () => {
    const consultar = async (d: string) => ({ numberExists: d === "554199998888" });
    expect(await numeroExisteNoWhatsapp(consultar, "+5541999998888")).toBe(true);
  });

  it("false quando as duas grafias respondem que não", async () => {
    const vistas: string[] = [];
    const consultar = async (d: string) => {
      vistas.push(d);
      return { numberExists: false };
    };
    expect(await numeroExisteNoWhatsapp(consultar, "+5541999998888")).toBe(false);
    expect(vistas).toEqual(["5541999998888", "554199998888"]);
  });

  it("null quando o transporte falha: não saber não descarta ninguém", async () => {
    const consultar = async (): Promise<{ numberExists: boolean }> => {
      throw new Error("http 502");
    };
    expect(await numeroExisteNoWhatsapp(consultar, "+5541999998888")).toBeNull();
  });

  it("null quando uma grafia falhou e a outra disse que não", async () => {
    let n = 0;
    const consultar = async () => {
      if (n++ === 0) throw new Error("timeout");
      return { numberExists: false };
    };
    expect(await numeroExisteNoWhatsapp(consultar, "+5541999998888")).toBeNull();
  });
});
