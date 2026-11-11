declare module 'piexifjs' {
  type Tags<K extends string> = { readonly [P in K]: number };
  const piexif: {
    ImageIFD: Tags<'Orientation' | 'Software' | 'Make' | 'Model' | 'DateTime'>;
    ExifIFD: Tags<'DateTimeOriginal' | 'ISOSpeedRatings' | 'ExposureTime' | 'FNumber' | 'FocalLength' | 'LensModel'>;
    GPSIFD: Tags<'GPSLatitudeRef' | 'GPSLatitude' | 'GPSLongitudeRef' | 'GPSLongitude'>;
    dump(o: Record<string, Record<number, unknown>>): string;
    insert(exif: string, jpeg: string): string;
  };
  export default piexif;
}
