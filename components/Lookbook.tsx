import Image from "next/image";
import Link from "next/link";
import type { LookSlide } from "@/data/types";
import { backdropClass } from "@/lib/backdrops";
import { RevealItem } from "@/components/ui/Reveal";
import { LookbookRail } from "@/components/LookbookRail";
import { cn } from "@/lib/format";

interface LookbookProps {
  slides: LookSlide[];
}

/**
 * Server component. Slide markup (images, captions, links) is server-rendered;
 * only the rail wrapper and dot indicators are client, because they need the
 * scroll observer. Hover scale is pure CSS — no JS involved.
 *
 * Mobile: native scroll-snap carousel. Desktop (lg+): the same slides as a
 * 3-column grid — one DOM tree, not two.
 */
export function Lookbook({ slides }: LookbookProps) {
  return (
    <section className="py-section lg:py-section-lg" aria-label="Latest looks">
      <LookbookRail
        captions={slides.map((s) => s.caption)}
        className={cn(
          "snap-rail gap-3 px-gutter",
          "lg:grid lg:grid-cols-3 lg:gap-6 lg:overflow-visible lg:px-gutter-lg",
        )}
      >
        {slides.map((slide, i) => (
          <RevealItem
            key={slide.id}
            className="snap-item w-[82vw] sm:w-[60vw] lg:w-auto"
          >
            {/* Alternating depth: the eye reads the difference between
                neighbouring layers, so a small spread is enough. */}
            <div data-depth={i % 2 === 0 ? 0.55 : 0.25}>
            <Link href={slide.href} className="group block">
              <div
                data-curtain
                className={cn(
                  "relative aspect-[3/4] w-full overflow-hidden",
                  backdropClass[slide.backdrop],
                )}
              >
                <Image
                  src={slide.image.src}
                  alt={slide.image.alt}
                  fill
                  loading="lazy"
                  sizes="(min-width: 1024px) 33vw, 82vw"
                  className="object-cover object-top transition-transform duration-500 ease-in-out group-hover:scale-105"
                />
              </div>
              <p className="mt-3 text-label font-bold uppercase tracking-[0.18em] text-bone/60 transition-colors duration-200 ease-in-out group-hover:text-bone">
                {slide.caption}
              </p>
            </Link>
            </div>
          </RevealItem>
        ))}
      </LookbookRail>
    </section>
  );
}
