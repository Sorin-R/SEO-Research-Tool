require("dotenv").config();
const { GoogleAdsApi } = require("google-ads-api");

const client = new GoogleAdsApi({
  client_id: process.env.GOOGLE_ADS_CLIENT_ID,
  client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN
});

const customer = client.Customer({
  customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN
});

async function testConnection() {

  try {

    const result = await customer.query(`
      SELECT
        customer.id,
        customer.descriptive_name
      FROM customer
      LIMIT 1
    `);

    console.log("Connection successful!");
    console.log(result);

  } catch (error) {

    console.error("Google Ads API error:");
    console.error(error);

  }

}

testConnection();