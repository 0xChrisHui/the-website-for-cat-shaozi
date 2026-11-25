// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {MemorialPhotos} from "../../src/MemorialPhotos.sol";

interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes calldata revertData) external;
}

contract MemorialPhotosTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant NEXT_MINTER = address(0x100);
    address private constant RECIPIENT = address(0x200);
    string private constant TOKEN_URI = "https://example.invalid/assets/1.json";

    MemorialPhotos private photos;

    function setUp() public {
        photos = new MemorialPhotos("Photo Collection", "PHOTO");
    }

    function testDeployment() public view {
        require(keccak256(bytes(photos.name())) == keccak256("Photo Collection"), "name");
        require(keccak256(bytes(photos.symbol())) == keccak256("PHOTO"), "symbol");
        require(photos.owner() == address(this), "owner");
        require(photos.minter() == address(this), "minter");
    }

    function testOnlyOwnerChangesMinter() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, RECIPIENT));
        vm.prank(RECIPIENT);
        photos.setMinter(RECIPIENT);

        require(photos.minter() == address(this), "minter changed");
    }

    function testChangedMinterCanMintAndOwnerLosesMintPermission() public {
        photos.setMinter(NEXT_MINTER);
        require(photos.minter() == NEXT_MINTER, "minter");
        require(photos.owner() == address(this), "owner");

        vm.expectRevert(abi.encodeWithSelector(MemorialPhotos.UnauthorizedMinter.selector, address(this)));
        photos.mint(RECIPIENT, 1, TOKEN_URI);

        vm.prank(NEXT_MINTER);
        photos.mint(RECIPIENT, 1, TOKEN_URI);
        require(photos.ownerOf(1) == RECIPIENT, "token owner");
        require(keccak256(bytes(photos.tokenURI(1))) == keccak256(bytes(TOKEN_URI)), "URI");
    }

    function testRejectsDuplicateTokenId() public {
        photos.mint(RECIPIENT, 1, TOKEN_URI);

        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidSender.selector, address(0)));
        photos.mint(NEXT_MINTER, 1, "https://example.invalid/assets/2.json");

        require(photos.ownerOf(1) == RECIPIENT, "token owner changed");
        require(keccak256(bytes(photos.tokenURI(1))) == keccak256(bytes(TOKEN_URI)), "URI changed");
    }

    function testRejectsZeroRecipient() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, address(0)));
        photos.mint(address(0), 1, TOKEN_URI);
    }

    function testRejectsZeroMinter() public {
        vm.expectRevert(abi.encodeWithSelector(MemorialPhotos.InvalidMinter.selector));
        photos.setMinter(address(0));
        require(photos.minter() == address(this), "minter changed");
    }
}
