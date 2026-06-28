import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

export default function Terms() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Terms & Conditions</Text>
      <View style={styles.content}>
        <Text style={styles.section}><Text style={styles.bold}>1. Acceptance of Terms</Text>{`

`}By accessing and using the doordrop mobile application and services, you agree to be bound by these Terms & Conditions. If you do not agree with any part of these terms, you may not use our service.</Text>

        <Text style={styles.section}><Text style={styles.bold}>2. Service Description</Text>{`

`}doordrop provides a platform for booking cargo pickup and delivery services. We connect users with independent contractors who perform the actual delivery services. We are not responsible for the quality of services provided by contractors.</Text>

        <Text style={styles.section}><Text style={styles.bold}>3. User Eligibility</Text>{`

`}You must be at least 18 years old to use this service. You warrant that you have the legal capacity to enter into a binding agreement. You must provide accurate and complete information during registration.</Text>

        <Text style={styles.section}><Text style={styles.bold}>4. User Responsibilities</Text>{`

`}As a user, you are responsible for:
• Maintaining confidentiality of your account credentials
• Providing accurate information about parcels and delivery locations
• Ensuring you have the right to send the items
• Complying with all applicable laws and regulations
• Not engaging in fraudulent or illegal activities
• Treating delivery personnel with respect and courtesy</Text>

        <Text style={styles.section}><Text style={styles.bold}>5. Prohibited Items</Text>{`

`}You may not send:
• Hazardous materials or explosives
• Illegal substances or contraband
• Weapons or firearms
• Counterfeit goods
• Items that violate intellectual property rights
• Perishable items (unless specially arranged)
• Items that are dangerous or could cause harm

doordrop reserves the right to refuse service for prohibited items.</Text>

        <Text style={styles.section}><Text style={styles.bold}>6. Pricing and Payment</Text>{`

`}All prices are displayed before you confirm your order. Prices may vary based on distance, weight, and delivery urgency. Payment must be made through the app using accepted payment methods. Failed payments may result in order cancellation. doordrop is not responsible for currency conversion issues.</Text>

        <Text style={styles.section}><Text style={styles.bold}>7. Cancellation Policy</Text>{`

`}Orders can be cancelled before a driver accepts the job. Cancellations after driver acceptance may incur a cancellation fee. No refunds are provided for services partially completed or for customer-requested delays.</Text>

        <Text style={styles.section}><Text style={styles.bold}>8. Liability Limitations</Text>{`

`}{`doordrop is provided "AS IS" without warranties. To the maximum extent permitted by law:
• We are not liable for loss, damage, or theft of parcels
• We are not liable for delays caused by factors beyond our control
• We are not liable for indirect, consequential, or punitive damages
• Our total liability shall not exceed the delivery fee paid

For valuable items, we recommend purchasing additional insurance.`}</Text>

        <Text style={styles.section}><Text style={styles.bold}>9. Insurance and Liability</Text>{`

`}By default, deliveries are covered up to a limited amount. For items exceeding this value, you must declare the value and may purchase additional insurance. doordrop is not liable for undeclared valuables.</Text>

        <Text style={styles.section}><Text style={styles.bold}>10. Contractor Relationship</Text>{`

`}Delivery partners are independent contractors, not employees of doordrop. We are not responsible for their actions, negligence, or violations of law. Disputes with drivers should be reported through the app.</Text>

        <Text style={styles.section}><Text style={styles.bold}>11. Privacy and Data</Text>{`

`}Your use of doordrop is also governed by our Privacy Policy. By using the app, you consent to the collection and use of your information as described in the Privacy Policy.</Text>

        <Text style={styles.section}><Text style={styles.bold}>12. Intellectual Property</Text>{`

`}All content in the doordrop app, including logos, text, and software, is our property or licensed to us. You may not reproduce, distribute, or modify any content without permission.</Text>

        <Text style={styles.section}><Text style={styles.bold}>13. Prohibited Conduct</Text>{`

`}You agree not to:
• Harass, threaten, or abuse delivery personnel
• Engage in illegal activities
• Attempt to hack or modify the app
• Provide false information
• Use the service for money laundering or fraud
• Engage in discriminatory behavior</Text>

        <Text style={styles.section}><Text style={styles.bold}>14. Suspension and Termination</Text>{`

`}We reserve the right to suspend or terminate your account for:
• Violation of these terms
• Payment fraud
• Abusive behavior toward personnel
• Repeated cancellations
• Sending prohibited items

Termination may be permanent and without refund of remaining credits.</Text>

        <Text style={styles.section}><Text style={styles.bold}>15. Dispute Resolution</Text>{`

`}Disputes shall be resolved through:
• Good faith negotiation
• Mediation (if negotiation fails)
• Binding arbitration (final recourse)

You waive the right to pursue class action lawsuits.</Text>

        <Text style={styles.section}><Text style={styles.bold}>16. Indemnification</Text>{`

`}You agree to indemnify and hold harmless doordrop from any claims, damages, or costs arising from:
• Your use of the service
• Violation of these terms
• Infringement of third-party rights
• Content you provide</Text>

        <Text style={styles.section}><Text style={styles.bold}>17. Changes to Terms</Text>{`

`}We may modify these terms at any time. Continued use of the app after changes constitutes acceptance of the new terms.</Text>

        <Text style={styles.section}><Text style={styles.bold}>18. Governing Law</Text>{`

`}These terms are governed by the laws of the United Republic of Tanzania, without regard to conflicts of law principles.</Text>

        <Text style={styles.section}><Text style={styles.bold}>19. Severability</Text>{`

`}If any provision of these terms is found invalid, the remaining provisions shall continue in effect.</Text>

        <Text style={styles.section}><Text style={styles.bold}>20. Contact Information</Text>{`

`}For questions about these terms, contact:
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
