"use client"

import { useState } from "react"

interface ClubImageProps {
  src: string
  srcSet?: string
  name: string
}

export function ClubImage({ src, srcSet, name }: ClubImageProps) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <span className="flex items-center justify-center text-center text-xl font-black text-lime px-4">
        {name}
      </span>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      srcSet={srcSet}
      sizes="(min-width: 640px) 200px, 100vw"
      alt={name}
      className="h-full w-full object-contain p-3"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}
