-- AlterTable
ALTER TABLE "BagLine" DROP CONSTRAINT "BagLine_pkey",
ADD COLUMN     "sku" TEXT NOT NULL DEFAULT '',
ADD CONSTRAINT "BagLine_pkey" PRIMARY KEY ("customerId", "productId", "sku");

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "size" TEXT,
ADD COLUMN     "sku" TEXT;

-- CreateTable
CREATE TABLE "StockLevel" (
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("sku")
);
