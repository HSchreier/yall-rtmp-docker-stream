import { Box, Container } from '@mui/material';
import { Navbar } from '../components/Navbar';
import { StreamingStatus } from '../components/StreamingStatus';

export function Dashboard() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Navbar />

      <Container maxWidth="lg" sx={{ py: 4, flex: 1 }}>
        <Box sx={{ maxWidth: '600px' }}>
          <StreamingStatus />
        </Box>
      </Container>
    </Box>
  );
}
