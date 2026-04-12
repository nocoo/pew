import { describe, it, expect } from "vitest";
import { BadgeIcon, type BadgeIconProps } from "./badge-icon";

describe("BadgeIcon", () => {
  // -------------------------------------------------------------------------
  // Export verification
  // -------------------------------------------------------------------------

  describe("exports", () => {
    it("should export BadgeIcon component", () => {
      expect(BadgeIcon).toBeDefined();
      expect(typeof BadgeIcon).toBe("function");
    });
  });

  // -------------------------------------------------------------------------
  // Type verification (compile-time checks)
  // -------------------------------------------------------------------------

  describe("props interface", () => {
    it("should accept valid BadgeIconProps", () => {
      // This is a compile-time check - if types are wrong, TypeScript will fail
      const props: BadgeIconProps = {
        text: "MVP",
        icon: "shield",
        colorBg: "#3B82F6",
        colorText: "#FFFFFF",
        size: "md",
        className: "test-class",
      };

      expect(props.text).toBe("MVP");
      expect(props.icon).toBe("shield");
      expect(props.colorBg).toBe("#3B82F6");
      expect(props.colorText).toBe("#FFFFFF");
      expect(props.size).toBe("md");
      expect(props.className).toBe("test-class");
    });

    it("should accept all icon variants", () => {
      const icons: Array<BadgeIconProps["icon"]> = [
        "shield",
        "star",
        "hexagon",
        "circle",
        "diamond",
        "crown",
        "flame",
        "zap",
        "heart",
        "sparkles",
      ];

      expect(icons).toHaveLength(10);
      icons.forEach((icon) => {
        expect(typeof icon).toBe("string");
      });
    });

    it("should accept all size variants", () => {
      const sizes: Array<NonNullable<BadgeIconProps["size"]>> = [
        "sm",
        "md",
        "lg",
      ];

      expect(sizes).toHaveLength(3);
      sizes.forEach((size) => {
        expect(typeof size).toBe("string");
      });
    });

    it("should allow optional props to be omitted", () => {
      // Minimal required props only
      const props: BadgeIconProps = {
        text: "X",
        icon: "circle",
        colorBg: "#000000",
        colorText: "#FFFFFF",
      };

      expect(props.size).toBeUndefined();
      expect(props.className).toBeUndefined();
    });
  });
});
