import type { CountedCategory } from "@/lib/catalogue";
import { fadeUpSm, stagger } from "@/lib/motion";
import { CategoryRow } from "@/components/CategoryRow";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";

interface CategoryListProps {
  heading: string;
  /** Counted by the caller, which already holds the catalogue. §30. */
  items: CountedCategory[];
}

/**
 * Server component. The `<ul>` is a `RevealItem` carrying stagger variants
 * rather than its own trigger, so it inherits the outer group's visible state
 * and passes the stagger down to the rows — same two-level cascade as before.
 */
export function CategoryList({ heading, items }: CategoryListProps) {
  return (
    <section className="py-section lg:py-section-lg">
      <RevealGroup staggerChildren={0.06}>
        <RevealItem
          as="h2"
          variants={fadeUpSm}
          className="eyebrow px-gutter pb-8 lg:px-gutter-lg"
        >
          {heading}
        </RevealItem>

        <RevealItem as="ul" variants={stagger(0.06)}>
          {items.map((category) => (
            <RevealItem
              key={category.id}
              as="li"
              variants={fadeUpSm}
              className="border-b border-bone/10 first:border-t"
            >
              <div data-slide>
                <CategoryRow category={category} />
              </div>
            </RevealItem>
          ))}
        </RevealItem>
      </RevealGroup>
    </section>
  );
}
