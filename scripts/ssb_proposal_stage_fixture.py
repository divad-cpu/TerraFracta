"""Inactive owned SSB processing adapter; trusted callbacks, never a connection.

The caller independently confirms earlier captures before selecting (2025,).
This fixed test adapter is not an operational account or authenticated loader.
"""
from workers.captured_update_pipeline import PipelineResumeRequired


class SSBProposalStage:
    def __init__(self, years, capture_annual, read_processing):
        assert years in ((2024, 2025), (2025,))
        self.years = years
        self.capture_annual = capture_annual
        self.read_processing = read_processing

    def process(self, manifest, work):
        assert manifest.mode == 'shadow'
        assert {source.source_key for source in manifest.sources} == {'ssb-14059-metadata', 'ssb-14059-data'}
        assert {(item.item_key, item.source_key) for item in manifest.items} == {
            ('ssb-14059-year-2024', 'ssb-14059-data'),
            ('ssb-14059-year-2025', 'ssb-14059-data'),
            ('ssb-14059-metadata-review', 'ssb-14059-metadata')}
        for year in self.years:
            outcome = self.capture_annual(year, work)
            if outcome != 'confirmed':
                raise PipelineResumeRequired('Annual proposal receipt is unconfirmed; recover before further work')
        return self.read_processing(manifest)

    def close(self, *_):
        raise AssertionError('Pending SSB metadata must not invoke closeout')
