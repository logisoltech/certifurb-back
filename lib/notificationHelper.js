// Utility function to create notifications for database events
export async function createNotification(event, data) {
  try {
    const response = await fetch('https://api.certifurb.com/api/cms/notifications/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event,
        data
      })
    });

    if (!response.ok) {
      console.error('Failed to create notification:', response.statusText);
      return false;
    }

    const result = await response.json();
    return result.success;
  } catch (error) {
    console.error('Error creating notification:', error);
    return false;
  }
}

// Helper functions for specific events
export const notificationEvents = {
  // User events
  userRegistered: (userData) => createNotification('user_registered', userData),
  
  // Order events
  orderCreated: (orderData) => createNotification('order_created', orderData),
  paymentFailed: (orderData) => createNotification('payment_failed', orderData),
  
  // Product events
  productAdded: (productData) => createNotification('product_added', productData),
  lowStock: (productData) => createNotification('low_stock', productData),
  
  // Auction events
  auctionProductAdded: (productData) => createNotification('auction_product_added', productData),
  auctionRequest: (requestData) => createNotification('auction_request', requestData),
  
  // Email events
  emailReceived: (emailData) => createNotification('email_received', emailData),
  
  // Shipment events
  shipmentCreated: (shipmentData) => createNotification('shipment_created', shipmentData),
  
  // Review events
  reviewSubmitted: (reviewData) => createNotification('review_submitted', reviewData),
  
  // System events
  systemAlert: (alertData) => createNotification('system_alert', alertData)
}; 