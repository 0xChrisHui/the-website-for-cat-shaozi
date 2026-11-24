// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract ToolchainToken is ERC721 {
    constructor() ERC721("Toolchain", "TOOL") {
        _mint(msg.sender, 1);
    }
}

contract ToolchainTest {
    function testLocalMint() public {
        ToolchainToken token = new ToolchainToken();
        require(token.ownerOf(1) == address(this), "unexpected owner");
    }
}
