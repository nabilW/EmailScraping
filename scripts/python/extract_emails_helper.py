from pathlib import Path
from typing import List, Optional

from extract_emails import (
    ContactFilterAndEmailAndLinkedinFactory,
    ContactFilterAndEmailFactory,
    ContactFilterAndLinkedinFactory,
    DefaultWorker,
)
from extract_emails.browsers.chrome_browser import ChromeBrowser
from extract_emails.browsers.requests_browser import RequestsBrowser
from extract_emails.data_savers import CsvSaver
from extract_emails.factories.base_factory import BaseFactory


FACTORIES = {
    'email': ContactFilterAndEmailFactory,
    'linkedin': ContactFilterAndLinkedinFactory,
    'email,linkedin': ContactFilterAndEmailAndLinkedinFactory,
}


def get_factory(data_type: str) -> BaseFactory:
    key = ','.join(sorted(part.strip() for part in data_type.split(',') if part.strip()))
    if not key:
        key = 'email'
    try:
        return FACTORIES[key]
    except KeyError as err:
        raise ValueError(f'Unsupported data type: {data_type}') from err


def get_browser(browser: str):
    browser = browser.lower().strip()
    if browser == 'requests':
        return RequestsBrowser()
    if browser == 'chrome':
        b = ChromeBrowser()
        b.open()
        return b
    raise ValueError(f'Unsupported browser: {browser}')

def run_extract(url: str, output_file: Path, browser_name: str = 'requests', data_type: str = 'email', depth: int = 1) -> int:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    factory_cls = get_factory(data_type)
    browser = get_browser(browser_name)
    try:
        factory = factory_cls(website_url=url, browser=browser, depth=depth)
        worker = DefaultWorker(factory=factory)
        data = worker.get_data()
    finally:
        if browser_name == 'chrome':
            browser.close()  # type: ignore
    saver = CsvSaver(output_path=output_file)
    saver.save(data)
    total = sum(len(item.data.get('email', []) or []) for item in data)
    return total


def main():
    import argparse

    parser = argparse.ArgumentParser(description='Run extract-emails helper and save to CSV.')
    parser.add_argument('--url', required=True, help='Target URL to scan')
    parser.add_argument('--output', required=True, help='CSV output path')
    parser.add_argument('--browser', default='requests', help="Browser backend: 'requests' or 'chrome'")
    parser.add_argument('--data-type', default='email', help="Data types to extract (comma separated): e.g. 'email' or 'email,linkedin'")
    parser.add_argument('--depth', type=int, default=1, help='Follow depth for crawling')

    args = parser.parse_args()

    count = run_extract(
        url=args.url,
        output_file=Path(args.output),
        browser_name=args.browser,
        data_type=args.data_type,
        depth=args.depth,
    )
    print(f'Extracted {count} emails -> {args.output}')


if __name__ == '__main__':
    main()
