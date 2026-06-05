function pick(row, ...keys) {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null) {
        return row[key];
      }
      const lower = key.toLowerCase();
      if (row[lower] !== undefined && row[lower] !== null) {
        return row[lower];
      }
    }
    return undefined;
  }
  
  function normalizeProduct(row) {
    return {
      ProductID: pick(row, "ProductID", "productid"),
      ProductName: pick(row, "ProductName", "productname"),
      ProductDesc: pick(row, "ProductDesc", "productdesc"),
      ProductPrice: pick(row, "ProductPrice", "productprice"),
      ProductImageURL: pick(row, "ProductImageURL", "productimageurl"),
      ProductCategory: pick(row, "ProductCategory", "productcategory"),
      ProductStorage: pick(row, "ProductStorage", "productstorage"),
      ProductRam: pick(row, "ProductRam", "productram"),
      ProductKeyboard: pick(row, "ProductKeyboard", "productkeyboard"),
      ProductScreenSize: pick(row, "ProductScreenSize", "productscreensize"),
      ProductModel: pick(row, "ProductModel", "productmodel"),
      ProductGraphics: pick(row, "ProductGraphics", "productgraphics"),
      ProductWeight: pick(row, "ProductWeight", "productweight"),
      ProductCpu: pick(row, "ProductCpu", "productcpu"),
      ProductResolution: pick(row, "ProductResolution", "productresolution"),
      ProductOs: pick(row, "ProductOs", "productos"),
      ProductBattery: pick(row, "ProductBattery", "productbattery"),
      ProductBluetooth: pick(row, "ProductBluetooth", "productbluetooth"),
      ProductWifi: pick(row, "ProductWifi", "productwifi"),
      ProductCamera: pick(row, "ProductCamera", "productcamera"),
      ProductAudio: pick(row, "ProductAudio", "productaudio"),
      ProductBrand: pick(row, "ProductBrand", "productbrand"),
      CreatedAt: pick(row, "CreatedAt", "createdat"),
    };
  }
  
  function normalizeCategory(value) {
    return String(value || "").trim().toLowerCase();
  }
  
  function matchesCategory(productCategory, filterCategory) {
    const product = normalizeCategory(productCategory);
    const filter = normalizeCategory(filterCategory);
  
    if (!filter) return true;
    if (!product) return false;
  
    if (filter === "monitors") {
      return ["lcd", "led", "monitor", "monitors"].includes(product);
    }
  
    if (filter === "laptop" || filter === "laptops") {
      return product === "laptop" || product === "laptops";
    }
  
    return product === filter || product.includes(filter) || filter.includes(product);
  }
  
  function matchesBrand(productBrand, filterBrand) {
    if (!filterBrand) return true;
    const product = String(productBrand || "").trim().toLowerCase();
    const filter = String(filterBrand || "").trim().toLowerCase();
    if (!product) return false;
    return product === filter || product.includes(filter);
  }
  
  module.exports = {
    normalizeProduct,
    matchesCategory,
    matchesBrand,
  };
  