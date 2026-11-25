// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

contract MemorialPhotos is ERC721URIStorage, Ownable {
    error UnauthorizedMinter(address caller);
    error InvalidMinter();

    event MinterChanged(address indexed previousMinter, address indexed newMinter);

    address public minter;

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) Ownable(msg.sender) {
        minter = msg.sender;
        emit MinterChanged(address(0), msg.sender);
    }

    function setMinter(address next) external onlyOwner {
        if (next == address(0)) revert InvalidMinter();

        emit MinterChanged(minter, next);
        minter = next;
    }

    function mint(address to, uint256 tokenId, string calldata tokenUri) external {
        if (msg.sender != minter) revert UnauthorizedMinter(msg.sender);

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenUri);
    }
}
