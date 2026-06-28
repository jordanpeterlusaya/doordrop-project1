import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

export default function PrivacyPolicy() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Privacy Policy</Text>
      <View style={styles.content}>
        <Text style={styles.section}><Text style={styles.bold}>1. Introduction</Text>{`

`}{'doordrop ("we," "us," "our," or "Company") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and otherwise process personal information in connection with our mobile application and services.'}</Text>

        <Text style={styles.section}><Text style={styles.bold}>2. Information We Collect</Text>{`

`}{`We collect information you provide directly, such as:
• Account registration details (name, email, phone number, address)
• Delivery preferences and saved locations
• Payment information
• Driver's license or identification documents
• Location data (GPS coordinates during pickups and deliveries)
• Communication history
• Parcel descriptions and contents (limited information for safety)

We also automatically collect:
• Device information (device type, operating system, unique identifiers)
• App usage data and analytics
• Network information (IP address, WiFi connection status)
• Crash reports and error logs`}</Text>

        <Text style={styles.section}><Text style={styles.bold}>3. How We Use Your Information</Text>{`

`}We use collected information to:
• Process and fulfill your delivery requests
• Verify your identity and prevent fraud
• Communicate about your orders and account
• Improve our services and user experience
• Comply with legal obligations
• Send promotional materials (with your consent)
• Troubleshoot technical issues
• Maintain security and prevent abuse</Text>

        <Text style={styles.section}><Text style={styles.bold}>4. Information Sharing</Text>{`

`}We may share your information with:
• Delivery partners and contractors
• Payment processors and financial institutions
• Law enforcement (when legally required)
• Service providers who assist our operations
• Business partners with your consent

We do not sell your personal information to third parties for marketing purposes.</Text>

        <Text style={styles.section}><Text style={styles.bold}>5. Data Security</Text>{`

`}We implement industry-standard security measures including encryption, secure servers, and access controls. However, no method of transmission is 100% secure. We cannot guarantee absolute security of your information.</Text>

        <Text style={styles.section}><Text style={styles.bold}>6. Your Rights</Text>{`

`}You have the right to:
• Access your personal information
• Correct inaccurate data
• Request deletion of your data
• Opt-out of marketing communications
• Data portability (where applicable)

Contact us at doordrop225@gmail.com to exercise these rights.</Text>

        <Text style={styles.section}><Text style={styles.bold}>7. Location Services</Text>{`

`}Our app uses GPS and location services to track deliveries in real-time. You can disable location tracking through your device settings, though this may limit app functionality.</Text>

        <Text style={styles.section}><Text style={styles.bold}>8. Cookies and Tracking</Text>{`

`}We use cookies, analytics tools, and similar technologies to enhance your experience. You can manage cookie preferences through your device or browser settings.</Text>

        <Text style={styles.section}><Text style={styles.bold}>{"9. Children's Privacy"}</Text>{`

`}Our service is not directed to children under 13. We do not knowingly collect information from children. If we learn we have collected data from a child under 13, we will delete it promptly.</Text>

        <Text style={styles.section}><Text style={styles.bold}>10. Changes to This Policy</Text>{`

`}We may update this Privacy Policy periodically. We will notify you of material changes by updating the date below. Your continued use of the app constitutes acceptance of the revised policy.</Text>

        <Text style={styles.section}><Text style={styles.bold}>11. Contact Us</Text>{`

`}For privacy concerns or requests, contact us at:
Email: doordrop225@gmail.com
Address: doordrop, Dar es Salaam, Tanzania

Last Updated: May 2026</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'flex-start', padding: 24, paddingTop: 64, backgroundColor: '#fff' },
  content: { marginTop: 12 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#000' },
  section: { marginTop: 16, lineHeight: 24, fontSize: 14, color: '#000' },
  bold: { fontWeight: 'bold', fontSize: 15 },
});
