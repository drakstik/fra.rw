# Project Overview
This project is for a website belonging to Fragile Ltd., a Rwanda-based skateboarding community and brand. 

Inspiration websites:
- supreme.com -- Simple & intuitive design, but too focused on the clothing alone.
- yeezy.com -- Simple & intuitive design, but too focused on the clothing alone.
- golfleFleur.com -- Design is not as intuitive, but it has great imagery/content that does not just focus on the clothes, locations & scenes represent a cultural brand not just a clothing brand.

The Fragile Ltd. website will have items for sale (skateboard, clothes, shoes, etc...), and articles with videos & image content.

# Users, Roles & Auth
There are 3 user roles:
- Customer 
- Operator
- Admin

All users (not just Customers) can browse/shop and navigate/read the published articles.
The Admin role has access to the entire DB.
The Operator role can post items for sale and request for articles to be published. All posts are reviewed and published by an Admin. 

### Registering Users
Customers are not greeted with an obvious login button. To maintain a persistent virtual product basket for each unique customer, we will use long-lasting JWTs.
There are 2 ways we collect customer's identifiers (email/phone),

1. Email & Phone number for marketing content. This does NOT create an customer account. The entry point for this will be at the bottom of every page.
2. Email & Phone number for order history and delivery tracking. This does create a customer account. The entry point for this will be right before payment and basket info + JWT will transfer to an logged in customer account's JWT.

Admins and Operators are invited by the initial Admin with an invitation link sent to their email, where they must then create login credentials.
