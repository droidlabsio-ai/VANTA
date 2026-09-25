import Image from "next/image";
import type { BrandStatementContent } from "@/data/types";
import { backdropClass } from "@/lib/backdrops";
import { fadeUpSm } from "@/lib/motion";
import { RevealHeadline } from "@/components/scroll/RevealHeadline";
import { TechnicalFrame } from "@/components/scroll/TechnicalFrame";
import { PillButton } from "@/components/ui/PillButton";
import { Reveal, RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { cn } from "@/lib/format";

interface BrandStatementProps {
  content: BrandStatementContent;
}

/**
 * Server component. All markup is server-rendered; the reveal wrappers are the
 * only client boundaries.
 */
export function BrandStatement({ content }: BrandStatementProps) {
  return (
    <section className="relative py-section lg:py-section-lg">
      <TechnicalFrame label="Fig. 02 — Series 026" />
      <div className="lg:mx-auto lg:grid lg:max-w-container lg:grid-cols-2 lg:items-center lg:gap-16 lg:px-gutter-lg">
        {/* Portrait */}
        <Reveal
          className={cn(
            "relative aspect-[4/5] w-full overflow-hidden lg:order-last lg:aspect-[3/4]",
            backdropClass[content.backdrop],
          )}
        >
          {/* The shutter (§45) opens this inner layer, so the frame's backdrop
              colour shows around the slit. */}
          <div data-aperture className="absolute inset-0 overflow-hidden">
            <Image
              src={content.image.src}
              alt={content.image.alt}
              fill
              loading="lazy"
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover object-top"
            />
          </div>
        </Reveal>

        {/* Copy */}
        <RevealGroup staggerChildren={0.09} className="px-gutter pt-10 lg:px-0 lg:pt-0">
          <RevealItem variants={fadeUpSm} as="p" className="eyebrow">
            {content.eyebrow}
          </RevealItem>

          {/* Sets itself character by character — no Framer wrapper here, or
              the block fade and the char rise would fight each other. */}
          <RevealHeadline
            lines={content.headline}
            className="mt-5 text-display-sm text-bone lg:text-display-md"
          />

          <RevealItem
            variants={fadeUpSm}
            as="p"
            className="mt-6 max-w-prose whitespace-pre-line text-base leading-relaxed text-bone/70"
          >
            {content.description}
          </RevealItem>

          <RevealItem variants={fadeUpSm} className="mt-8">
            <PillButton href={content.cta.href} block>
              {content.cta.label}
            </PillButton>
          </RevealItem>
        </RevealGroup>
      </div>
    </section>
  );
}
