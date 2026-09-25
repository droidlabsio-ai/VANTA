import Image from "next/image";
import type { HeroContent } from "@/data/types";
import { backdropClass } from "@/lib/backdrops";
import { PillButton } from "@/components/ui/PillButton";
import { HeroHeadline } from "@/components/hero/HeroHeadline";
import { HeroCopy } from "@/components/hero/HeroCopy";

interface HeroProps {
  hero: HeroContent;
}

/**
 * Server component. The LCP element is the hero image, so it is rendered here
 * — no client boundary between it and the document, nothing to hydrate before
 * it can paint. Only the headline reveal and the copy fade are client leaves.
 */
export function Hero({ hero }: HeroProps) {
  return (
    <section className="relative">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-12 lg:pl-gutter-lg lg:pt-[calc(var(--header-h)+2rem)] xl:gap-16">
        {/* Image — bleeds to the right edge on desktop, on its accent backdrop */}
        <div
          data-hero-media
          className={`relative order-first aspect-[4/5] w-full overflow-hidden sm:aspect-[16/10] lg:order-last lg:aspect-[4/5] lg:max-h-[calc(100vh-8rem)] ${backdropClass[hero.backdrop]}`}
        >
          <Image
            src={hero.image.src}
            alt={hero.image.alt}
            fill
            priority
            fetchPriority="high"
            sizes="(min-width: 1024px) 52vw, 100vw"
            className="scale-[1.12] object-cover object-top"
          />
          {/* Bottom scrim so the mobile headline stays legible over the photo */}
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink via-ink/70 to-transparent lg:hidden" />

          {/* Mobile headline sits over the image */}
          <div className="absolute inset-x-0 bottom-0 px-gutter pb-6 lg:hidden">
            <HeroHeadline lines={hero.headline} className="text-display-sm text-bone" />
          </div>
        </div>

        {/* Copy column */}
        <div data-hero-copy className="px-gutter pb-16 pt-6 lg:px-0 lg:pb-20 lg:pt-0">
          <div className="hidden lg:block">
            <HeroHeadline
              lines={hero.headline}
              className="text-[clamp(3.25rem,5.4vw,5rem)] leading-[0.88] tracking-[-0.03em] text-bone"
            />
          </div>

          <HeroCopy className="lg:mt-10 lg:max-w-md">
            {/* `whitespace-pre-line`: the description is a plain string, and an
                editor pressing Enter in the admin expects that break to appear.
                Without it HTML collapses the newline to a space and the
                formatting is silently discarded. */}
            <p className="max-w-prose whitespace-pre-line text-base leading-relaxed text-bone/70">
              {hero.description}
            </p>
            <div className="mt-8">
              <PillButton href={hero.cta.href} block>
                {hero.cta.label}
              </PillButton>
            </div>
          </HeroCopy>
        </div>
      </div>
    </section>
  );
}
