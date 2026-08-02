import { MapPin, Phone, Clock } from "lucide-react"
import { getPublishedClubs } from "@/app/actions/clubs"
import { blobUrl, blobImage, blobSrcSet } from "@/lib/blob"
import { ClubImage } from "@/components/club-image"

export async function ClubsSection({ heading = true }: { heading?: boolean }) {
  const clubs = await getPublishedClubs()

  return (
    <section className="bg-navy py-16">
      <div className="mx-auto max-w-6xl px-4">
        {heading && (
          <div className="text-center mb-10">
            <span className="inline-block rounded-full bg-lime/20 px-4 py-1.5 text-sm font-bold text-lime mb-3">
              Find Your Club
            </span>
            <h2 className="text-3xl font-black text-white sm:text-4xl">Our Affiliated Clubs</h2>
            <p className="mt-2 text-navy-foreground/70 text-sm">Choose a location near you</p>
          </div>
        )}

        {clubs.length === 0 ? (
          <p className="text-center text-navy-foreground/60">New clubs coming soon!</p>
        ) : (
          <div className="space-y-4">
            {clubs.map((club) => {
              const features = Array.isArray(club.features) ? (club.features as string[]) : []
              // Full https:// or local public path URLs are used directly.
              // Only blob storage pathnames (no leading /) go through blobImage/blobUrl.
              const isDirectUrl =
                club.imageUrl?.startsWith("https://") ||
                club.imageUrl?.startsWith("http://") ||
                club.imageUrl?.startsWith("/")
              const imgSrc = isDirectUrl
                ? club.imageUrl
                : (blobImage(club.imageUrl, 640) ?? blobUrl(club.imageUrl) ?? club.image)
              const imgSrcSet = isDirectUrl ? undefined : blobSrcSet(club.imageUrl)

              return (
                <article
                  key={club.id}
                  className="overflow-hidden rounded-2xl bg-white shadow-xl"
                >
                  <div className="flex flex-col sm:grid sm:grid-cols-[200px_1fr]">
                    {/* Club image — uses a client component to handle onError fallback */}
                    <div className="relative flex h-48 items-center justify-center overflow-hidden bg-navy/90 sm:h-auto">
                      {imgSrc ? (
                        <ClubImage src={imgSrc} srcSet={imgSrcSet} name={club.name} />
                      ) : (
                        <span className="flex items-center justify-center text-center text-xl font-black text-lime px-4">
                          {club.name}
                        </span>
                      )}
                    </div>

                    <div className="p-4 sm:p-5">
                      <h3 className="text-xl font-black text-navy">{club.name}</h3>
                      <p className="font-bold text-lime text-sm">{club.location}</p>
                      {club.description && (
                        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                          {club.description}
                        </p>
                      )}
                      <ul className="mt-3 space-y-1.5 text-sm">
                        <li className="flex items-center gap-2 text-foreground/80">
                          <MapPin className="h-4 w-4 shrink-0 text-lime" />
                          {club.address}
                        </li>
                        <li className="flex items-center gap-2 text-foreground/80">
                          <Phone className="h-4 w-4 shrink-0 text-lime" />
                          {club.phone}
                        </li>
                        <li className="flex items-center gap-2 text-foreground/80">
                          <Clock className="h-4 w-4 shrink-0 text-lime" />
                          {club.hours}
                        </li>
                      </ul>
                      {features.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {features.map((f) => (
                            <span
                              key={f}
                              className="rounded-full bg-lime/15 px-3 py-1 text-xs font-bold text-navy"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
