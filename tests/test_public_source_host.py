"""Numeric host witnesses use local parsing only, never name resolution or HTTP."""
from ipaddress import IPv4Address
from socket import inet_aton
import unittest
from workers.public_source_url import public_https_source_url

class PublicSourceHostTests(unittest.TestCase):
    def test_alternative_numeric_ipv4_cannot_be_a_public_domain(self):
        for host in ('0x7f.0.0.1','127.0x0.0.1','0177.0x0.0.1','0x7f.1','0x7f.0.1','0x0a.0.0.1','0xc0.0250.0x0.1','0x8.0x8.0x8.0x8'):
            with self.subTest(host=host):
                self.assertIsInstance(IPv4Address(inet_aton(host)),IPv4Address)
                self.assertFalse(public_https_source_url('https://'+host+'/table'))
    def test_numeric_ending_host_cannot_hide_ipv4_or_an_invalid_numeric_url(self):
        for host in ('example.123','example.0x123','data.example.09','127.0x','data.example.0x','0xffffffff.0','0x100.0.0.1','127.0.1','127.1'):
            with self.subTest(host=host):self.assertFalse(public_https_source_url('https://'+host+'/table'))
    def test_non_numeric_domain_labels_keep_existing_shape_admission(self):
        for host in ('data.example.org','0x7f.example.org','127.example.org','data.0xg','example.1a','xn--bcher-kva.example.org'):
            with self.subTest(host=host):self.assertTrue(public_https_source_url('https://'+host+'/table?lang=en&year=2025'))
    def test_existing_ip_local_credentials_and_query_refusals_are_preserved(self):
        for url in ('https://127.0.0.1/table','https://[::1]/table','https://data.local/table','https://data.internal/table','https://user:invented@example.org/table','https://example.org/table?%61pi_key=INVENTED','https://example.org./table'):
            with self.subTest(url=url):self.assertFalse(public_https_source_url(url))

if __name__=='__main__':unittest.main()
