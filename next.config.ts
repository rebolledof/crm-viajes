import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // El logo admite hasta 512 KB (SPEC-002c). Se deja margen para que un archivo más grande llegue
    // a la acción y la persona vea "pesa más de 512 KB" en lugar de un error genérico.
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
